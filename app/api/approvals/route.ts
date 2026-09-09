/**
 * Human approval for the agent's irreversible actions.
 *
 * Two tools pause for the user: `save_user_memory` (writes to their profile)
 * and `clear_all_form_fields` (wipes the form). TrueForge pauses the call and
 * it is recorded here as a pending approval. Nothing happens until the user
 * decides:
 *
 *  - approve → the harness turn is resumed with `allow`; TrueForge executes
 *    save_user_memory against /api/mcp/[sessionId], which performs the write.
 *  - reject  → the turn is resumed with `deny` and a reason, so the agent
 *    carries on without the save (and knows not to ask again).
 *
 *   GET  /api/approvals?sessionId=xxx   → pending approvals for a session
 *   POST /api/approvals                 → { approvalId, decision }
 */
import { NextRequest, NextResponse } from "next/server";
import {
  initSchema,
  getSession,
  getPendingApprovals,
  resolveMemoryApproval,
  appendChatMessages,
} from "@/lib/db";
import { persistTurnOutcome } from "@/lib/agent-turns";
import { runTurn } from "@/lib/trueforge";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  try {
    await initSchema();
    return NextResponse.json({ approvals: await getPendingApprovals(sessionId) });
  } catch (err) {
    console.error("[GET /api/approvals]", err);
    return NextResponse.json({ error: "Could not load approvals" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: { approvalId?: string; decision?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { approvalId, decision } = body;
  if (!approvalId) {
    return NextResponse.json({ error: "approvalId is required" }, { status: 400 });
  }
  if (decision !== "approve" && decision !== "reject") {
    return NextResponse.json(
      { error: "decision must be 'approve' or 'reject'" },
      { status: 400 }
    );
  }

  try {
    await initSchema();

    const approval = await resolveMemoryApproval(
      approvalId,
      decision === "approve" ? "approved" : "rejected"
    );

    // resolveMemoryApproval only transitions rows still in 'pending', so a
    // double-click or replayed request lands here instead of resuming twice.
    if (!approval) {
      return NextResponse.json(
        { error: "That approval no longer exists or has already been decided." },
        { status: 409 }
      );
    }

    // Record the outcome in the conversation so the user sees it and the agent
    // knows on its next turn not to ask again.
    const note =
      approval.kind === "clear_all_fields"
        ? decision === "approve"
          ? "Clearing the form now."
          : "Understood — I've left the form as it was."
        : decision === "approve"
          ? `Saved **${approval.label}** to your profile — I'll fill it in automatically on future forms.`
          : `Understood, I won't save **${approval.label}** to your profile.`;

    await appendChatMessages(approval.sessionId, [
      { role: "assistant", content: note },
    ]);

    // Resume the paused TrueForge tool call with the user's decision. On
    // allow, the harness executes save_user_memory (which performs the write);
    // on deny it tells the agent why and the loop continues without saving.
    if (approval.tfThreadId && approval.tfToolCallId) {
      const session = await getSession(approval.sessionId);
      const tfSessionId = session?.tf_session_id as string | undefined;

      if (tfSessionId) {
        try {
          const outcome = await runTurn(tfSessionId, [
            {
              type: "user.tool_approval",
              threadId: approval.tfThreadId,
              toolCallId: approval.tfToolCallId,
              approval:
                decision === "approve"
                  ? { status: "allow" }
                  : {
                      status: "deny",
                      reason:
                        approval.kind === "clear_all_fields"
                          ? "The user declined clearing the form. Leave every field as it is."
                          : "The user declined saving this value to their profile.",
                    },
            },
          ]);
          await persistTurnOutcome(approval.sessionId, approval.userId, outcome);
        } catch (err) {
          // The decision is already recorded; a resume failure only means the
          // agent's follow-up is missing, which the next message recovers.
          console.error("[POST /api/approvals] resume failed:", err);
        }
      }
    }

    return NextResponse.json({ approval, message: note });
  } catch (err) {
    console.error("[POST /api/approvals]", err);
    return NextResponse.json({ error: "Could not record your decision" }, { status: 500 });
  }
}
