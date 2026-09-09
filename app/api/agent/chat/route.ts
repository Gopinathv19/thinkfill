/**
 * POST /api/agent/chat
 *
 * The form-filling agent, run by the TrueForge agent harness.
 *
 * This route no longer talks to a model provider. Each form session gets a
 * TrueForge session (created lazily on the first message) whose agent is bound
 * to this app's per-session MCP server, so the harness owns the loop: model
 * calls, tool routing, iteration limits, and context management.
 *
 * Two things are still deliberately not left to the model:
 *
 *  - **Session scoping.** Tools never take a `session_id` argument. The id is
 *    baked into the connector URL (/api/mcp/[sessionId]) that TrueForge calls,
 *    so the agent cannot touch a session other than the one on screen.
 *  - **Writing to memory.** TrueForge pauses every save_user_memory call for
 *    human approval. The paused call is surfaced as a pending approval here,
 *    and the user's decision resumes it via /api/approvals.
 *
 * Conversation history for the UI lives in this app's database; the agent's
 * working context lives in the TrueForge session, which persists across turns
 * and page reloads.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  initSchema,
  getSession,
  appendChatMessages,
  getChatMessages,
  getPendingApprovals,
} from "@/lib/db";
import { isResendOfUnansweredTurn } from "@/lib/chat-history";
import { persistTurnOutcome, declinePendingApprovals } from "@/lib/agent-turns";
import {
  ensureTrueForgeSession,
  runTurn,
  describeTurnFailure,
  type TurnOutcome,
} from "@/lib/trueforge";

export const runtime = "nodejs";

/** How many past turns to consider when detecting a retried message. */
const HISTORY_LIMIT = 60;

export async function POST(req: NextRequest) {
  let body: { message?: string; sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message, sessionId } = body;
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  await initSchema();

  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const userId = (session.user_id as string) ?? process.env.DEMO_USER_ID ?? "demo-user-001";

  // Connect this form to the harness on first contact: register the
  // per-session MCP server and create the TrueForge session that uses it.
  let tfSessionId: string;
  try {
    ({ tfSessionId } = await ensureTrueForgeSession(session));
  } catch (err) {
    console.error("[agent/chat] could not provision TrueForge session:", err);
    return NextResponse.json({ error: describeTurnFailure(err) }, { status: 503 });
  }

  // A thread with a pending approval rejects user messages outright, so the
  // user typing rather than clicking the card would wedge the session. Treat
  // the message as declining the save and carry on.
  try {
    await declinePendingApprovals(sessionId, userId, tfSessionId);
  } catch (err) {
    console.error("[agent/chat] could not clear pending approvals:", err);
  }

  // Persist the user's turn before doing anything that can fail, so it is not
  // lost if the harness call errors. A resend of a turn that never got a reply
  // (e.g. after an outage) is treated as a retry rather than appended twice.
  const priorHistory = await getChatMessages(sessionId, HISTORY_LIMIT);
  if (!isResendOfUnansweredTurn(priorHistory, message)) {
    await appendChatMessages(sessionId, [{ role: "user", content: message }]);
  }

  let outcome: TurnOutcome;
  try {
    outcome = await runTurn(tfSessionId, [{ type: "user.message", content: message }]);
  } catch (err) {
    console.error("[agent/chat] turn failed:", err);
    return NextResponse.json({ error: describeTurnFailure(err) }, { status: 502 });
  }

  const text = await persistTurnOutcome(sessionId, userId, outcome);

  return NextResponse.json({
    message: text,
    toolCalls: outcome.toolCallLog,
    pendingApprovals: await getPendingApprovals(sessionId),
    finishReason: outcome.approvals.length ? "approval_required" : "stop",
  });
}
