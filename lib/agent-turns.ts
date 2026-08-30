/**
 * lib/agent-turns.ts
 * Shared handling for a completed TrueForge turn: persist its messages for the
 * chat UI and register any paused save_user_memory calls as pending approvals.
 *
 * Used by /api/agent/chat (user messages) and /api/approvals (resume turns,
 * which can themselves pause on the agent's next save).
 */
import {
  appendChatMessages,
  createMemoryApproval,
  getPendingApprovals,
  resolveMemoryApproval,
} from "./db";
import { labelForMemoryKey } from "./memory-keys";
import { runTurn, pendingApprovalCalls, type TurnOutcome } from "./trueforge";

/** Returns the assistant text shown to the user for this turn. */
export async function persistTurnOutcome(
  sessionId: string,
  userId: string,
  outcome: TurnOutcome
): Promise<string> {
  if (outcome.chatTurns.length) {
    await appendChatMessages(sessionId, outcome.chatTurns);
  }

  for (const approval of outcome.approvals) {
    const refs = { threadId: approval.threadId, toolCallId: approval.toolCallId };

    if (approval.toolName === "save_user_memory") {
      const fieldKey = approval.args.field_key ?? "";
      await createMemoryApproval(
        sessionId,
        userId,
        fieldKey,
        labelForMemoryKey(fieldKey),
        approval.args.value ?? "",
        refs,
        "memory_save"
      );
    } else if (approval.toolName === "clear_all_form_fields") {
      // Wiping the form is destructive and not undoable, so it goes through
      // the same human gate as a profile write rather than happening the
      // moment the agent decides to.
      await createMemoryApproval(
        sessionId,
        userId,
        "clear_all_fields",
        "Clear the whole form",
        "",
        refs,
        "clear_all_fields"
      );
    }
  }

  let text = outcome.assistantText ?? "";
  if (!text.trim() && outcome.approvals.length) {
    // The turn paused before the model could speak; say why the chat is
    // waiting so the approval card doesn't appear out of nowhere.
    text = outcome.approvals.some((a) => a.toolName === "clear_all_form_fields")
      ? "That will empty every field on this form and can't be undone — confirm below and I'll do it."
      : "I'd like to save that to your profile for future forms — please approve or decline below.";
    await appendChatMessages(sessionId, [{ role: "assistant", content: text }]);
  }
  return text;
}

/** Passes of "resolve everything pending" before giving up (see below). */
const MAX_DECLINE_PASSES = 3;

/**
 * Clear any pending save-to-profile decisions by declining them.
 *
 * TrueForge refuses a new user message while a thread has an approval pending
 * (422, "user message cannot be sent while approvals or questions are
 * pending"), so a user who types instead of clicking the card would otherwise
 * wedge the session — and on /chat the card may not even be visible.
 *
 * Declining is the right default: nothing reaches the profile without explicit
 * consent, and if the message actually was consent ("yes, save it"), the agent
 * reads it on the very next turn and offers again.
 *
 * Each decline is itself a turn, and the agent may respond by asking to save
 * something else, so this repeats — bounded, because "resolve, then check
 * again" must terminate even if the model keeps asking.
 *
 * Returns the number of approvals declined.
 */
export async function declinePendingApprovals(
  sessionId: string,
  userId: string,
  tfSessionId: string
): Promise<number> {
  const DENY_REASON =
    "The user replied with a message instead of approving, so the value was not saved. Do not ask about saving it again unless they bring it up.";
  let declined = 0;

  for (let pass = 0; pass < MAX_DECLINE_PASSES; pass++) {
    // The harness decides what actually blocks the thread; the local rows only
    // supply the label to show the user. A paused call with no local row still
    // has to be cleared, or every later message is rejected.
    const [blocking, rows] = await Promise.all([
      pendingApprovalCalls(tfSessionId),
      getPendingApprovals(sessionId),
    ]);
    if (blocking.length === 0 && rows.length === 0) break;

    for (const row of rows) {
      await resolveMemoryApproval(row.id, "rejected");
      declined++;
      await appendChatMessages(sessionId, [
        {
          role: "assistant",
          content:
            row.kind === "clear_all_fields"
              ? "I left the form as it was — nothing was cleared."
              : `I didn't save **${row.label}** to your profile — ask me any time if you change your mind.`,
        },
      ]);
    }

    for (const call of blocking) {
      try {
        const outcome = await runTurn(tfSessionId, [
          {
            type: "user.tool_approval",
            threadId: call.threadId,
            toolCallId: call.toolCallId,
            approval: { status: "deny", reason: DENY_REASON },
          },
        ]);
        await persistTurnOutcome(sessionId, userId, outcome);
      } catch (err) {
        // The local decision stands either way; the user's message still needs
        // to get through, and a stuck turn is reported by the caller.
        console.error("[agent-turns] could not decline pending approval:", err);
      }
    }

    // Nothing was blocking the harness, so the local rows were all that needed
    // clearing — no need to look again.
    if (blocking.length === 0) break;
  }

  return declined;
}
