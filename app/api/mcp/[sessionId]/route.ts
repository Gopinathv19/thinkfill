/**
 * /api/mcp/[sessionId] — ThinkFill's MCP server.
 *
 * A real Model Context Protocol endpoint (JSON-RPC 2.0 over streamable HTTP)
 * that TrueForge connects to as a remote connector. TrueForge's client is the
 * official @modelcontextprotocol/sdk, which performs the standard handshake:
 *
 *   initialize → notifications/initialized → tools/list → tools/call
 *
 * Session scoping is the whole point of the dynamic segment: one connector is
 * registered per form session (see lib/trueforge.ts), and the session id lives
 * in the URL — never in a tool argument — so the model cannot read or write
 * any session other than the one the user is looking at.
 *
 * save_user_memory is the only tool that writes to the user's profile, and
 * TrueForge is configured to pause it for human approval. By the time this
 * handler runs it, the user has already said yes.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getSession,
  getSessionFields,
  updateFieldValue,
  clearFieldValues,
  fillFieldsFromMemory,
  getMemory,
  saveMemory,
  getAllMemory,
  initSchema,
} from "@/lib/db";
import { resolveMemoryKey, canonicalizeKey, normalizeLabel } from "@/lib/memory-keys";

export const runtime = "nodejs";

// ─── Tool definitions ────────────────────────────────────────────────────────
//
// No schema takes a session or user id — both come from the URL's session.
// readOnlyHint keeps TrueForge's default @write approval policy off the
// lookup tools even if the agent spec's explicit list is ever removed.

const TOOL_DEFINITIONS = [
  {
    name: "get_form_state",
    description:
      "Returns every field in the form being filled, with its current value, status, and the memory_key its value can be saved under. Call this first.",
    inputSchema: { type: "object", properties: {}, required: [] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "find_memory_matches",
    description:
      "Returns the missing fields that can be filled immediately from the user's saved profile. Call this right after get_form_state, and fill every match before asking the user anything.",
    inputSchema: { type: "object", properties: {}, required: [] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "fill_from_memory",
    description:
      "Fills EVERY missing field that has a saved value, in one step, and returns what was filled and what still needs the user. Use this instead of calling fill_form_field once per known field — it is the fastest way to start a form.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_user_memory",
    description:
      "Looks up a single saved value in the user's profile by memory key. Prefer find_memory_matches; use this only to check one specific key.",
    inputSchema: {
      type: "object",
      properties: {
        field_key: {
          type: "string",
          description: "Memory key, e.g. 'full_name', 'email', 'occupation'",
        },
      },
      required: ["field_key"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_user_memory",
    description: "Returns everything currently saved in the user's profile.",
    inputSchema: { type: "object", properties: {}, required: [] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "fill_form_field",
    description: "Sets the value of one field in the form.",
    inputSchema: {
      type: "object",
      properties: {
        field_id: { type: "string", description: "The field id from get_form_state" },
        value: { type: "string", description: "The value to write" },
        source: {
          type: "string",
          enum: ["memory", "user", "ai"],
          description:
            "'memory' if taken from the saved profile, 'user' if the user just told you, 'ai' if you derived it",
        },
      },
      required: ["field_id", "value"],
    },
  },
  {
    name: "save_user_memory",
    description:
      "Saves one value to the user's profile so future forms can be filled automatically. This call pauses for the user's explicit approval — call it when a fill_form_field result suggests it, and never announce the save as done until this tool has returned.",
    inputSchema: {
      type: "object",
      properties: {
        field_key: { type: "string", description: "The field's memory_key from get_form_state" },
        value: { type: "string", description: "The value to save" },
      },
      required: ["field_key", "value"],
    },
  },
  {
    name: "clear_form_field",
    description:
      "Empties one field, returning it to 'missing'. Use only when the user explicitly asks to clear, remove, reset or re-enter a value. Never clear a field to 'make room' for a new value — fill_form_field overwrites on its own.",
    inputSchema: {
      type: "object",
      properties: {
        field_id: { type: "string", description: "The field id from get_form_state" },
      },
      required: ["field_id"],
    },
  },
  {
    name: "clear_all_form_fields",
    description:
      "Empties every field in the form so the user can start over. Destructive and not undoable — call it only when the user has clearly asked to clear or reset the whole form, and say how many fields were cleared afterwards. Never call it to fix a single wrong value; use clear_form_field for that.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

// ─── Tool implementations ────────────────────────────────────────────────────

interface ToolContext {
  sessionId: string;
  userId: string;
}

/**
 * Map whatever the model passed as `field_id` onto a real field in this form.
 *
 * Small models routinely pass the memory key ("full_name") or the visible
 * label ("Applicant Full Name") instead of the field id. Rather than spending
 * a round trip telling the model to call get_form_state again, the near-misses
 * are resolved here. An unfilled field is preferred when several match, so
 * repeated fills advance through the form instead of overwriting one field.
 */
async function resolveFieldId(sessionId: string, candidate: string): Promise<string | null> {
  if (!candidate) return null;

  const fields = await getSessionFields(sessionId);

  const exact = fields.find((f) => f.id === candidate);
  if (exact) return exact.id;

  const preferMissing = (matches: typeof fields) =>
    matches.find((f) => f.status === "missing") ?? matches[0];

  const wantedKey = canonicalizeKey(candidate);
  const byMemoryKey = fields.filter((f) => f.memoryKey && f.memoryKey === wantedKey);
  if (byMemoryKey.length) return preferMissing(byMemoryKey).id;

  const wantedLabel = normalizeLabel(candidate);
  const byLabel = fields.filter((f) => normalizeLabel(f.label) === wantedLabel);
  if (byLabel.length) return preferMissing(byLabel).id;

  return null;
}

async function executeTool(
  name: string,
  args: Record<string, string>,
  ctx: ToolContext
): Promise<unknown> {
  switch (name) {
    case "get_form_state": {
      const fields = await getSessionFields(ctx.sessionId);
      const missing = fields.filter((f) => f.status === "missing");
      const filled = fields.filter((f) => f.status === "filled");
      return {
        totalFields: fields.length,
        filledCount: filled.length,
        missingCount: missing.length,
        completionPercent: fields.length
          ? Math.round((filled.length / fields.length) * 100)
          : 0,
        fields: fields.map((f) => ({
          id: f.id,
          label: f.label,
          section: f.section,
          type: f.type,
          value: f.value,
          status: f.status,
          options: f.options,
          memory_key: f.memoryKey,
        })),
      };
    }

    case "find_memory_matches": {
      const [fields, memory] = await Promise.all([
        getSessionFields(ctx.sessionId),
        getAllMemory(ctx.userId) as Promise<{ field_key: string; value: string }[]>,
      ]);
      const byKey = new Map(memory.map((m) => [m.field_key, m.value]));

      const matches = fields
        .filter((f) => f.status === "missing" && f.memoryKey && byKey.has(f.memoryKey))
        .map((f) => ({
          field_id: f.id,
          label: f.label,
          memory_key: f.memoryKey,
          value: byKey.get(f.memoryKey as string),
        }));

      const unmatched = fields
        .filter((f) => f.status === "missing" && !(f.memoryKey && byKey.has(f.memoryKey)))
        .map((f) => ({ field_id: f.id, label: f.label, memory_key: f.memoryKey }));

      return {
        matchCount: matches.length,
        matches,
        needsUserInput: unmatched,
      };
    }

    case "get_user_memory": {
      if (!args.field_key) return { error: "field_key is required" };
      const record = await getMemory(ctx.userId, args.field_key);
      return record
        ? { found: true, field_key: args.field_key, value: record.value }
        : { found: false, field_key: args.field_key, value: null };
    }

    case "list_user_memory": {
      const records = (await getAllMemory(ctx.userId)) as {
        field_key: string;
        value: string;
      }[];
      return {
        count: records.length,
        memory: records.map((r) => ({ key: r.field_key, value: r.value })),
      };
    }

    case "fill_form_field": {
      if (!args.field_id || args.value === undefined) {
        return { success: false, error: "field_id and value are required" };
      }
      const source = (args.source as "memory" | "user" | "ai") ?? "ai";

      const fieldId = await resolveFieldId(ctx.sessionId, args.field_id);
      if (!fieldId) {
        return {
          success: false,
          error: `No field '${args.field_id}' in this form. Call get_form_state for the valid ids.`,
        };
      }

      const updated = await updateFieldValue(ctx.sessionId, fieldId, args.value, "filled", source);
      if (!updated) {
        return { success: false, error: `Could not write to field '${fieldId}'.` };
      }

      // Suggesting the save is a policy step, not a judgement call, so it is
      // decided here: only user-supplied values for rememberable fields, and
      // only when the profile doesn't already hold that exact value. The
      // model then calls save_user_memory, which the harness pauses for the
      // user's approval.
      let saveHint: string | undefined;
      if (source === "user" && args.value.trim()) {
        const resolved = resolveMemoryKey(
          (updated.label as string) ?? "",
          (updated.field_key as string) ?? ""
        );
        if (resolved) {
          const existing = await getMemory(ctx.userId, resolved.key);
          if (existing?.value !== args.value) {
            saveHint = `This value can be reused on future forms. Call save_user_memory with field_key="${resolved.key}" — the user will be asked to approve before anything is stored.`;
          }
        }
      }

      return {
        success: true,
        field_id: fieldId,
        value: args.value,
        ...(saveHint ? { suggestion: saveHint } : {}),
      };
    }

    case "save_user_memory": {
      if (!args.field_key || args.value === undefined) {
        return { success: false, error: "field_key and value are required" };
      }
      const saved = await saveMemory(ctx.userId, args.field_key, args.value);
      return {
        success: true,
        field_key: saved.field_key,
        value: saved.value,
        message: `Saved '${saved.field_key}' to the user's profile for future forms.`,
      };
    }

    case "fill_from_memory": {
      // Deterministic work, done deterministically. Asking the model to issue
      // one fill_form_field per match made a routine step depend on it
      // remembering to make N sequential calls — which it stops doing reliably
      // as a session's context grows, reporting success without having filled
      // anything. Shared with the workspace button so both behave identically.
      const { filled, stillMissing } = await fillFieldsFromMemory(ctx.sessionId, ctx.userId);
      return {
        success: true,
        filledCount: filled.length,
        filled,
        stillMissing,
        message:
          filled.length === 0
            ? "Nothing in the profile matched the missing fields."
            : `Filled ${filled.length} ${filled.length === 1 ? "field" : "fields"} from the saved profile. ${stillMissing.length} still need the user.`,
      };
    }

    case "clear_form_field": {
      if (!args.field_id) return { success: false, error: "field_id is required" };

      const fieldId = await resolveFieldId(ctx.sessionId, args.field_id);
      if (!fieldId) {
        return {
          success: false,
          error: `No field '${args.field_id}' in this form. Call get_form_state for the valid ids.`,
        };
      }

      const cleared = await clearFieldValues(ctx.sessionId, fieldId);
      return cleared > 0
        ? { success: true, field_id: fieldId, cleared: 1 }
        : { success: false, error: `Could not clear field '${fieldId}'.` };
    }

    case "clear_all_form_fields": {
      const cleared = await clearFieldValues(ctx.sessionId);
      return {
        success: true,
        cleared,
        message:
          cleared === 0
            ? "The form was already empty; nothing to clear."
            : `Cleared ${cleared} ${cleared === 1 ? "field" : "fields"}. The form is now empty.`,
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── JSON-RPC plumbing ───────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * Load the session, retrying once on failure.
 *
 * Both calls are network round trips to Postgres, and a single transient blip
 * used to surface to the agent as an opaque MCP transport error mid-form. One
 * short retry turns that into a hiccup nobody notices.
 */
async function loadSession(sessionId: string) {
  try {
    await initSchema();
    return await getSession(sessionId);
  } catch (err) {
    console.warn("[mcp] database call failed, retrying once:", err);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await initSchema();
    return await getSession(sessionId);
  }
}

/**
 * The protocol versions this server has been exercised against. An unknown
 * (newer) client version is answered with our latest rather than rejected,
 * per the MCP version-negotiation rules.
 */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

async function handleRpc(
  msg: JsonRpcRequest,
  ctx: ToolContext
): Promise<Record<string, unknown> | null> {
  const id = msg.id ?? null;
  const method = msg.method ?? "";

  // Notifications (no id) get no response body.
  if (msg.id === undefined || msg.id === null) {
    return null;
  }

  switch (method) {
    case "initialize": {
      const requested = String(msg.params?.protocolVersion ?? "");
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: {
          name: "thinkfill",
          title: "ThinkFill Form Tools",
          version: "1.0.0",
        },
      });
    }

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, { tools: TOOL_DEFINITIONS });

    case "tools/call": {
      const toolName = String(msg.params?.name ?? "");
      const toolArgs = (msg.params?.arguments ?? {}) as Record<string, string>;

      if (!TOOL_DEFINITIONS.some((t) => t.name === toolName)) {
        return rpcError(id, -32602, `Unknown tool: ${toolName}`);
      }

      // Tool failures are reported in-band (isError) so the model can read
      // them and recover, per the MCP spec; protocol errors stay JSON-RPC.
      try {
        const result = await executeTool(toolName, toolArgs, ctx);
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
          isError: false,
        });
      } catch (err) {
        console.error(`[mcp] tool '${toolName}' threw:`, err);
        return rpcResult(id, {
          content: [{ type: "text", text: `Tool '${toolName}' failed: ${String(err)}` }],
          isError: true,
        });
      }
    }

    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ─── HTTP handlers ───────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }

  try {
    const session = await loadSession(sessionId);
    if (!session) {
      return NextResponse.json(
        rpcError(null, -32002, `Unknown ThinkFill session: ${sessionId}`),
        { status: 404 }
      );
    }

    const ctx: ToolContext = {
      sessionId,
      userId: (session.user_id as string) ?? process.env.DEMO_USER_ID ?? "demo-user-001",
    };

    // A single message is the norm; older protocol revisions also allow a batch.
    if (Array.isArray(body)) {
      const responses = (
        await Promise.all(body.map((m) => handleRpc(m as JsonRpcRequest, ctx)))
      ).filter((r) => r !== null);
      if (responses.length === 0) return new Response(null, { status: 202 });
      return NextResponse.json(responses);
    }

    const response = await handleRpc(body as JsonRpcRequest, ctx);
    // Notifications (e.g. notifications/initialized) are accepted with no body.
    if (response === null) return new Response(null, { status: 202 });
    return NextResponse.json(response);
  } catch (err) {
    // Say what actually broke. A bare "Internal error" reaches TrueForge as an
    // opaque transport failure and leaves nothing to debug from either side.
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[mcp] session ${sessionId} failed:`, err);
    return NextResponse.json(rpcError(null, -32603, `ThinkFill MCP server error: ${detail}`), {
      status: 500,
    });
  }
}

/**
 * Streamable HTTP allows a server to decline the optional server-push SSE
 * stream; clients fall back to plain request/response, which is all these
 * tools need.
 */
export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  // Stateless server: there is no per-connection session to terminate.
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
