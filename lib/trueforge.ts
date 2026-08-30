/**
 * lib/trueforge.ts
 * The bridge between ThinkFill and the TrueForge agent harness.
 *
 * TrueForge owns the agent loop: model calls, tool routing, context
 * management, and pausing for human approval. This module does three things:
 *
 *  1. Registers this app's MCP server with TrueForge — one server per form
 *     session, whose URL carries the session id so the agent never sees or
 *     chooses a session (see app/api/mcp/[sessionId]/route.ts).
 *  2. Creates the TrueForge session bound to that server, with
 *     `save_user_memory` marked as requiring human approval.
 *  3. Runs turns and folds the SSE event stream back into the shapes the rest
 *     of the app already stores and renders (chat messages, tool-call logs,
 *     pending approvals).
 */
import {
  TrueForge,
  isEventDelta,
  mergeEventDelta,
  type TrueForgeApi,
} from "@truefoundry/trueforge-sdk";
import {
  setSessionTrueForgeRefs,
  type NewChatMessage,
} from "./db";

// ─── Client ─────────────────────────────────────────────────────────────────

let _client: TrueForge | null = null;

export function getTrueForgeClient(): TrueForge {
  if (!_client) {
    _client = new TrueForge({
      baseUrl: trueforgeBaseUrl(),
      // Provisioning calls are quick; a slow one means the harness is wedged
      // and waiting longer helps nobody. Turn execution overrides this.
      timeoutInSeconds: 30,
    });
  }
  return _client;
}

/**
 * Abort a turn whose event stream has gone silent for this long.
 *
 * A whole-turn deadline is the wrong tool: a legitimate turn that fills a
 * dozen fields runs for minutes, while a wedged provider produces silence in
 * seconds. So the watchdog measures the gap *between* events and resets on
 * every one. Sized well above a slow first token (a healthy model answers in
 * under a second) and well below TrueForge's own 300s provider timeout, which
 * is what left the UI hanging for five minutes.
 */
function idleTimeoutMs(): number {
  const raw = Number(process.env.TRUEFORGE_IDLE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 90_000;
}

export function trueforgeBaseUrl(): string {
  return process.env.TRUEFORGE_URL ?? "http://localhost:8790";
}

function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/**
 * Registered connector name for a form session. Session ids are lowercase
 * UUIDs, which fits TrueForge's resource-name pattern (`^[a-z][a-z0-9._-]*`)
 * with the `thinkfill-` prefix supplying the leading letter.
 */
export function mcpServerNameFor(sessionId: string): string {
  return `thinkfill-${sessionId.toLowerCase()}`.slice(0, 64);
}

// ─── Model selection ────────────────────────────────────────────────────────

/**
 * Which of TrueForge's configured models to run. Pinned with TRUEFORGE_MODEL
 * (a `provider/model` FQN as listed by GET /api/v1/models); otherwise the
 * first configured model is used so a fresh setup works without extra config.
 */
async function resolveModelName(): Promise<string> {
  const pinned = process.env.TRUEFORGE_MODEL;
  if (pinned) return pinned;

  const client = getTrueForgeClient();
  const res = await client.models.list();
  const first = res.data?.[0];
  if (!first) {
    throw new Error(
      "TrueForge has no models configured. Add a model provider in TrueForge Settings → Models."
    );
  }
  return first.name;
}

// ─── Session provisioning ───────────────────────────────────────────────────

function buildInstructions(formName: string): string {
  return `You are ThinkFill, an assistant that fills in PDF forms for the user.

You are working on one form: "${formName}". Every tool acts on that form automatically — there is no session id, so never ask for one or invent one.

How to work:
1. Call get_form_state to see which fields are filled and which are missing.
2. Call find_memory_matches. For every match it returns, call fill_form_field with source="memory". Do not ask the user about these — they are already known.
3. For fields the user must supply, ask for ONE at a time, in plain language. Never ask for several fields in a single message.
4. When the user answers, call fill_form_field with source="user".
5. When a fill_form_field result suggests remembering the value, call save_user_memory for it. The harness pauses that call and asks the user to approve — never ask "should I save this?" in chat, and never claim something has been saved until the tool has actually run.
6. After each round, state progress briefly, e.g. "4 of 9 filled".

Rules:
- Never invent or guess a value. If you do not know it, ask.
- Fields with memory_key null (signatures, today's date, one-time codes) must never be saved to memory.
- Call at most one save_user_memory per turn, and only after the field itself is filled.
- Keep replies to a couple of sentences.
- When every field is filled, say so and stop calling tools.`;
}

/**
 * The pre-upload "lobby" agent: greets the user on /chat before any form
 * exists, answers questions about what ThinkFill can do, gathers what they
 * want to fill, and steers them toward uploading the PDF. It has no tools —
 * there is no form session yet, so there is nothing for it to act on.
 */
const LOBBY_INSTRUCTIONS = `You are ThinkFill, an assistant that fills in PDF forms for the user using their saved profile.

No form has been uploaded yet. Your only goals in this conversation:
1. Understand what the user wants to fill out (which form, for what purpose).
2. Get them to upload the PDF — they can drag & drop it into the chat or use the + button next to the message box.

What you can tell them about ThinkFill:
- Once they upload a fillable PDF, you read its fields and instantly fill everything already known from their saved profile.
- You ask for missing values one at a time, and offer to remember new answers for future forms — nothing is saved without their explicit approval.
- They can review and edit every field in the workspace view, and export the finished PDF.

Rules:
- Keep replies to one to three short sentences.
- You cannot see, fill, or analyse anything before the PDF is uploaded — never pretend otherwise, never invent fields or values.
- Whatever the user asks, be helpful, then bring the conversation back to uploading the form.`;

/**
 * Create the harness session behind the /chat lobby. No MCP servers, tight
 * iteration limit — it is a pure conversation.
 */
export async function createLobbySession(): Promise<string> {
  const client = getTrueForgeClient();
  const model = await resolveModelName();
  const created = await client.sessions.create({
    agent: {
      spec: {
        model: { name: model, params: { temperature: 0.4 } },
        instructions: LOBBY_INSTRUCTIONS,
        config: {
          iterationLimit: 4,
          sandbox: { enabled: false },
          dynamicSubAgents: { enabled: false },
          generativeUi: { enabled: false },
          askUserQuestions: { enabled: false },
        },
      },
    },
  });
  return created.data.id;
}

export interface TrueForgeRefs {
  tfSessionId: string;
  mcpServerName: string;
}

/** The form-filling agent definition, shared by session create and update. */
function buildFormAgentSpec(
  formName: string,
  mcpServerName: string,
  model: string
): TrueForgeApi.AgentSpec {
  return {
    model: {
      name: model,
      // One tool call at a time keeps at most one approval pending, which
      // is what the approval card UI expects.
      params: { temperature: 0.2, parallel_tool_calls: false },
    },
    instructions: buildInstructions(formName),
    mcpServers: [
      {
        name: mcpServerName,
        preload: true,
        // Only the memory write pauses for a human. Everything else —
        // including fill_form_field, which TrueForge would otherwise
        // classify as a write tool and pause on every call — runs freely.
        requireApprovalForTools: ["save_user_memory"],
      },
    ],
    config: {
      iterationLimit: 16,
      sandbox: { enabled: false },
      // The chat panel renders plain text and this workload never needs
      // subagents; disabling both keeps small models on the rails.
      dynamicSubAgents: { enabled: false },
      generativeUi: { enabled: false },
      askUserQuestions: { enabled: false },
    },
  };
}

/**
 * Idempotently connect a form session to TrueForge: register (or refresh) the
 * per-session MCP server and create the harness session that uses it. The ids
 * are persisted on the form_sessions row so subsequent turns reuse them.
 *
 * A session's agent spec is snapshotted at creation, so a session created when
 * TRUEFORGE_MODEL pointed at a model that has since become unusable (rate
 * limited, retired) would keep failing forever. When the configured model no
 * longer matches the one recorded for the session, the spec is pushed to the
 * existing harness session rather than stranding it.
 */
export async function ensureTrueForgeSession(session: {
  id: string;
  form_name?: string;
  tf_session_id?: string | null;
  mcp_server_name?: string | null;
  tf_model?: string | null;
}): Promise<TrueForgeRefs> {
  const client = getTrueForgeClient();
  const model = await resolveModelName();

  if (session.tf_session_id && session.mcp_server_name) {
    if (session.tf_model !== model) {
      await client.sessions.update(session.tf_session_id, {
        agent: {
          spec: buildFormAgentSpec(
            session.form_name ?? "your form",
            session.mcp_server_name,
            model
          ),
        },
      });
      await setSessionTrueForgeRefs(
        session.id,
        session.tf_session_id,
        session.mcp_server_name,
        model
      );
    }
    return {
      tfSessionId: session.tf_session_id,
      mcpServerName: session.mcp_server_name,
    };
  }

  const mcpServerName = mcpServerNameFor(session.id);

  // The URL carries the session id, so TrueForge's tool calls are scoped
  // server-side and the model cannot address another user's session.
  await client.settings.mcpServers.createOrUpdate({
    manifest: {
      type: "remote",
      name: mcpServerName,
      url: `${appBaseUrl()}/api/mcp/${session.id}`,
      description: `ThinkFill form-filling tools for session ${session.id}`,
    },
  });

  const created = await client.sessions.create({
    agent: {
      spec: buildFormAgentSpec(session.form_name ?? "your form", mcpServerName, model),
    },
  });

  const tfSessionId = created.data.id;
  await setSessionTrueForgeRefs(session.id, tfSessionId, mcpServerName, model);

  return { tfSessionId, mcpServerName };
}

// ─── Turn execution ─────────────────────────────────────────────────────────

export interface PendingToolApproval {
  threadId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, string>;
}

export interface TurnOutcome {
  /** Final assistant text for the turn, if the model produced one. */
  assistantText: string | null;
  /** Assistant/tool turns in the shape chat_messages stores. */
  chatTurns: NewChatMessage[];
  /** Flat log of tool calls for the API response. */
  toolCallLog: Array<{ tool: string; args: unknown; result: unknown }>;
  /** save_user_memory calls the harness paused, waiting on the user. */
  approvals: PendingToolApproval[];
}

function contentToText(
  content: TrueForgeApi.ModelMessageEventContent | null | undefined
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
    .join("");
}

/**
 * Resolve a tool call to the tool that actually ran.
 *
 * TrueForge exposes MCP tools two ways and the model picks per call: directly
 * by name, or through its deferred-tools wrapper as
 * `call_tool({mcp_server, tool_name, input})`. Both reach the same MCP server,
 * but only the direct form carries the real name on the tool call — so
 * anything keyed on tool name (notably spotting the `save_user_memory` the
 * harness paused for approval) silently misses every wrapped call, leaving a
 * turn paused with no approval card and every later message rejected with
 * "user message cannot be sent while approvals or questions are pending".
 *
 * Unwrapping here means the rest of the app only ever sees real tool names.
 */
export function unwrapToolCall(
  name: string,
  args: Record<string, string>
): { name: string; args: Record<string, string> } {
  if (name === "call_tool" && typeof args.tool_name === "string") {
    const input = (args as unknown as { input?: Record<string, string> }).input;
    return {
      name: args.tool_name,
      args: input && typeof input === "object" ? input : {},
    };
  }
  return { name, args };
}

/** A tool call the harness has paused, waiting on the user. */
export interface HarnessPendingApproval {
  threadId: string;
  toolCallId: string;
}

/**
 * Ask the harness which tool calls it is currently blocked on.
 *
 * The harness is the authority here, not this app's `memory_approvals` table:
 * a paused call that never made it into the database (an older session, a
 * failed write) is invisible locally but still blocks every future message on
 * the thread. Reading the last turn's `requiredActions` finds those orphans so
 * they can be cleared.
 */
export async function pendingApprovalCalls(
  tfSessionId: string
): Promise<HarnessPendingApproval[]> {
  const client = getTrueForgeClient();

  // Turns come back oldest-first and paginated, so the blocking one is the
  // *last* item across all pages — reading `data[0]` finds the oldest turn,
  // whose approvals were resolved long ago, and misses the one actually
  // holding the thread.
  let page = await client.sessions.listTurns(tfSessionId, { limit: 25 });
  let latest: TrueForgeApi.Turn | undefined;
  for (;;) {
    for (const turn of page.data) {
      if (!latest || turn.createdAt > latest.createdAt) latest = turn;
    }
    if (!page.hasNextPage()) break;
    page = await page.getNextPage();
  }

  if (!latest || latest.state.status !== "done") return [];

  const pending: HarnessPendingApproval[] = [];
  for (const action of latest.state.requiredActions ?? []) {
    if (action.type !== "tool.approval_required") continue;
    for (const call of action.toolCalls) {
      pending.push({ threadId: action.threadId, toolCallId: call.id });
    }
  }
  return pending;
}

/** Raised when a turn is abandoned because its event stream went silent. */
export class TurnStalledError extends Error {
  constructor(idleMs: number) {
    super(
      `The model did not respond within ${Math.max(1, Math.round(idleMs / 1000))}s. It may be rate limited or overloaded — try again, or pick a different model with TRUEFORGE_MODEL.`
    );
    this.name = "TurnStalledError";
  }
}

/**
 * Turn a harness/provider failure into something worth showing a user.
 *
 * The raw errors are provider plumbing ("Request failed (429):"), which tells
 * the person at the keyboard nothing about what to do next.
 */
export function describeTurnFailure(err: unknown): string {
  if (err instanceof TurnStalledError) return err.message;

  const message = err instanceof Error ? err.message : String(err);

  if (/\b429\b|too many requests|rate.?limit/i.test(message)) {
    return "The model provider is rate limiting requests right now. Wait a moment and try again, or switch TRUEFORGE_MODEL to another model configured in TrueForge.";
  }
  if (/timeout|timed out|UND_ERR_HEADERS_TIMEOUT/i.test(message)) {
    return "The model took too long to respond. It may be overloaded — try again, or switch TRUEFORGE_MODEL to another model.";
  }
  if (/ECONNREFUSED|fetch failed|Failed to fetch|ENOTFOUND/i.test(message)) {
    return `Could not reach TrueForge at ${trueforgeBaseUrl()}. Start it with \`npx @truefoundry/trueforge\` and try again.`;
  }
  if (/\b401\b|\b403\b|unauthor|api key|forbidden/i.test(message)) {
    return "The model provider rejected TrueForge's API key. Check the provider's key in TrueForge → Settings → Models.";
  }
  if (/approvals or questions are pending/i.test(message)) {
    return "There's a save-to-profile decision still waiting. Choose Approve or Don't Save on the card, then send your message again.";
  }
  return `The agent turn failed: ${message}`;
}

/**
 * Execute one turn (a user message, or an approval/denial resume) and collect
 * the event stream into chat history rows, a tool-call log, and any approvals
 * the harness is now waiting on.
 *
 * Throws {@link TurnStalledError} if the stream stops producing events (see
 * `idleTimeoutMs`), rather than waiting on TrueForge's own 300s provider
 * timeout.
 */
export async function runTurn(
  tfSessionId: string,
  input: TrueForgeApi.TurnInputItem[]
): Promise<TurnOutcome> {
  const client = getTrueForgeClient();
  const idleMs = idleTimeoutMs();

  // The watchdog aborts the stream if no event arrives for `idleMs`; every
  // event rearms it, so a long turn that keeps making progress is never cut off.
  const abort = new AbortController();
  let stalled = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const rearm = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      stalled = true;
      abort.abort();
    }, idleMs);
  };

  rearm();
  let stream;
  try {
    stream = await client.sessions.createTurnStream(
      tfSessionId,
      { input },
      // Retrying a turn that already hung would multiply the wait, and the
      // harness may still be executing the original server-side.
      { abortSignal: abort.signal, maxRetries: 0, timeoutInSeconds: 3600 }
    );
  } catch (err) {
    if (watchdog) clearTimeout(watchdog);
    throw stalled ? new TurnStalledError(idleMs) : err;
  }

  const outcome: TurnOutcome = {
    assistantText: null,
    chatTurns: [],
    toolCallLog: [],
    approvals: [],
  };

  // Tool calls announced by model messages, so tool.response and
  // tool.approval_required events (which carry only ids) can be joined back
  // to a name and arguments.
  const toolCallsById = new Map<string, { name: string; args: Record<string, string> }>();

  // In the live stream a `model.message` event is an empty shell — its content
  // and tool calls arrive as `model.message.delta` events that are merged in.
  // The accumulated message is finalized when a later event proves it is
  // complete (the next message starts, a tool responds, or the turn ends).
  let pending: TrueForgeApi.ModelMessageEvent | null = null;

  const finalizePending = () => {
    if (!pending) return;
    const text = contentToText(pending.content);
    const toolCalls = pending.toolCalls ?? [];

    for (const tc of toolCalls) {
      let args: Record<string, string> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        // The harness reports the parse failure to the model itself.
      }
      toolCallsById.set(tc.id, unwrapToolCall(tc.function.name, args));
    }

    outcome.chatTurns.push({
      role: "assistant",
      content: text,
      toolCalls: toolCalls.length
        ? toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: tc.function,
          }))
        : null,
    });

    if (text.trim() && toolCalls.length === 0) {
      outcome.assistantText = text;
    }
    pending = null;
  };

  try {
    for await (const event of stream) {
      rearm();

      if (isEventDelta(event)) {
        if (pending) mergeEventDelta(pending, event);
        continue;
      }

      switch (event.type) {
        case "model.message": {
          finalizePending();
          pending = event;
          break;
        }

        case "tool.response": {
          finalizePending();
          const call = toolCallsById.get(event.toolCallId);
          let result: unknown = event.content;
          try {
            result = JSON.parse(event.content);
          } catch {
            // Leave non-JSON tool output as plain text.
          }
          outcome.toolCallLog.push({
            tool: call?.name ?? "unknown",
            args: call?.args ?? {},
            result,
          });
          outcome.chatTurns.push({
            role: "tool",
            content: event.content,
            toolCallId: event.toolCallId,
            toolName: call?.name,
          });
          break;
        }

        case "tool.approval_required": {
          finalizePending();
          for (const ref of event.toolCalls) {
            const call = toolCallsById.get(ref.id);
            outcome.approvals.push({
              threadId: event.threadId,
              toolCallId: ref.id,
              toolName: call?.name ?? "unknown",
              args: call?.args ?? {},
            });
          }
          break;
        }

        case "turn.done": {
          finalizePending();
          if (event.state.status === "error") {
            throw new Error(event.state.message);
          }
          if (event.state.status === "done" && event.state.output) {
            const text = contentToText(event.state.output.content);
            if (text.trim()) outcome.assistantText = text;
          }
          break;
        }

        // Thread lifecycle and MCP handshake events don't change what the app
        // stores.
        default:
          break;
      }
    }
  } catch (err) {
    if (!stalled) throw err;

    // The harness keeps executing a turn we stop listening to, and the next
    // turn would then be cancelled out from under the user. Best effort — the
    // stall is reported either way.
    try {
      await getTrueForgeClient().sessions.cancel(tfSessionId, {});
    } catch (cancelErr) {
      console.error("[trueforge] could not cancel stalled turn:", cancelErr);
    }
    throw new TurnStalledError(idleMs);
  } finally {
    if (watchdog) clearTimeout(watchdog);
  }

  finalizePending();
  return outcome;
}
