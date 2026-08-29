/**
 * POST /api/mcp
 * MCP (Model Context Protocol) tool server.
 * TrueForge calls this endpoint when the agent needs to use a tool.
 *
 * Supported tools:
 *   - get_form_state      → returns current form fields and their status
 *   - get_user_memory     → retrieves a saved memory value for a field key
 *   - fill_form_field     → updates a field value in the session
 *   - save_user_memory    → persists a key/value to user memory (after approval)
 *   - list_user_memory    → returns all saved memory records
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getSessionFields,
  updateFieldValue,
  getMemory,
  saveMemory,
  getAllMemory,
  initSchema,
} from "@/lib/db";

export const runtime = "nodejs";

// ─── Tool definitions (for TrueForge discovery) ─────────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: "get_form_state",
    description:
      "Returns the current state of all form fields in a session including their values, statuses, and which fields are still missing.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The active form session ID",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "get_user_memory",
    description:
      "Retrieves a previously saved value from the user's persistent memory for a specific field key. Use this before asking the user for information.",
    inputSchema: {
      type: "object",
      properties: {
        field_key: {
          type: "string",
          description: "The field key to look up (e.g. 'occupation', 'full_name')",
        },
      },
      required: ["field_key"],
    },
  },
  {
    name: "fill_form_field",
    description:
      "Fills a specific form field with a value. This is a deterministic action that updates the form state.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The active form session ID",
        },
        field_id: {
          type: "string",
          description: "The field ID to fill",
        },
        value: {
          type: "string",
          description: "The value to set for this field",
        },
        source: {
          type: "string",
          enum: ["memory", "user", "ai"],
          description: "Where this value came from",
        },
      },
      required: ["session_id", "field_id", "value"],
    },
  },
  {
    name: "save_user_memory",
    description:
      "Saves a value to the user's persistent memory so it can be reused in future forms. IMPORTANT: Always ask for user approval before calling this tool.",
    inputSchema: {
      type: "object",
      properties: {
        field_key: {
          type: "string",
          description: "The memory key (e.g. 'occupation')",
        },
        value: {
          type: "string",
          description: "The value to save",
        },
      },
      required: ["field_key", "value"],
    },
  },
  {
    name: "list_user_memory",
    description:
      "Returns all values currently saved in the user's persistent memory.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// ─── Tool handlers ───────────────────────────────────────────────────────────

async function handleGetFormState(params: Record<string, unknown>) {
  const sessionId = params.session_id as string;
  if (!sessionId) throw new Error("session_id is required");

  const fields = await getSessionFields(sessionId);
  const missing = fields.filter((f) => f.status === "missing");
  const filled = fields.filter((f) => f.status === "filled");

  return {
    sessionId,
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
      page: f.page,
    })),
    missingFields: missing.map((f) => ({ id: f.id, label: f.label, section: f.section })),
  };
}

async function handleGetUserMemory(params: Record<string, unknown>) {
  const fieldKey = params.field_key as string;
  if (!fieldKey) throw new Error("field_key is required");

  const userId = process.env.DEMO_USER_ID ?? "demo-user-001";
  const record = await getMemory(userId, fieldKey);

  if (!record) {
    return { found: false, field_key: fieldKey, value: null };
  }

  return {
    found: true,
    field_key: fieldKey,
    value: record.value,
    saved_at: record.updated_at,
  };
}

async function handleFillFormField(params: Record<string, unknown>) {
  const sessionId = params.session_id as string;
  const fieldId = params.field_id as string;
  const value = params.value as string;
  const source = (params.source as "memory" | "user" | "ai") ?? "ai";

  if (!sessionId || !fieldId || value === undefined) {
    throw new Error("session_id, field_id, and value are required");
  }

  const updated = await updateFieldValue(sessionId, fieldId, value, "filled", source);

  if (!updated) {
    return { success: false, error: `Field '${fieldId}' not found in session` };
  }

  return {
    success: true,
    field_id: fieldId,
    value,
    source,
    message: `Field '${fieldId}' has been filled with '${value}'`,
  };
}

async function handleSaveUserMemory(params: Record<string, unknown>) {
  const fieldKey = params.field_key as string;
  const value = params.value as string;

  if (!fieldKey || value === undefined) {
    throw new Error("field_key and value are required");
  }

  const userId = process.env.DEMO_USER_ID ?? "demo-user-001";
  await saveMemory(userId, fieldKey, value);

  return {
    success: true,
    field_key: fieldKey,
    value,
    message: `'${fieldKey}' has been saved to your memory for future use`,
  };
}

async function handleListUserMemory() {
  const userId = process.env.DEMO_USER_ID ?? "demo-user-001";
  const records = (await getAllMemory(userId)) as { field_key: string; value: string; updated_at: string }[];
  return {
    count: records.length,
    memory: records.map((r) => ({
      key: r.field_key,
      value: r.value,
      updated_at: r.updated_at,
    })),
  };
}

// ─── MCP Protocol Handler ────────────────────────────────────────────────────

export async function GET() {
  // TrueForge discovery endpoint — returns list of tools
  return NextResponse.json({
    name: "ThinkFill Form Tools",
    version: "1.0.0",
    description: "Tools for AI-assisted form filling with persistent user memory",
    tools: TOOL_DEFINITIONS,
  });
}

export async function POST(req: NextRequest) {
  try {
    await initSchema();

    const body = await req.json();

    // Support both MCP standard format and TrueForge format
    const toolName: string = body.tool ?? body.name ?? body.method ?? "";
    const params: Record<string, unknown> = body.params ?? body.arguments ?? body.input ?? {};

    let result: unknown;

    switch (toolName) {
      case "get_form_state":
        result = await handleGetFormState(params);
        break;
      case "get_user_memory":
        result = await handleGetUserMemory(params);
        break;
      case "fill_form_field":
        result = await handleFillFormField(params);
        break;
      case "save_user_memory":
        result = await handleSaveUserMemory(params);
        break;
      case "list_user_memory":
        result = await handleListUserMemory();
        break;
      default:
        return NextResponse.json(
          { error: `Unknown tool: '${toolName}'`, availableTools: TOOL_DEFINITIONS.map((t) => t.name) },
          { status: 400 }
        );
    }

    return NextResponse.json({ success: true, tool: toolName, result });
  } catch (err) {
    console.error("[mcp] Error:", err);
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}
