/**
 * lib/chat-history.ts
 *
 * Pure helpers for turning stored conversation rows into the shape an
 * OpenAI-compatible provider expects, and for reasoning about what state a
 * conversation is in. Kept out of the route handler so it can be tested
 * without a database or a model provider.
 */
import type { StoredChatMessage } from "./db";

/** A message in provider wire format. */
export type ProviderMessage = Record<string, unknown>;

/**
 * Stored row → the shape the provider expects on the way in.
 *
 * Assistant turns keep their tool_calls and tool turns keep their
 * tool_call_id, which is what lets the model see what it already looked up on
 * an earlier turn instead of repeating the work.
 */
export function toProviderMessage(m: StoredChatMessage): ProviderMessage {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.toolCallId, content: m.content ?? "" };
  }
  if (m.role === "assistant" && m.toolCalls?.length) {
    // Providers reject a null content alongside tool_calls.
    return { role: "assistant", content: m.content ?? "", tool_calls: m.toolCalls };
  }
  return { role: m.role, content: m.content ?? "" };
}

/**
 * True when `message` repeats the most recent user turn and that turn never
 * received a reply.
 *
 * It is not enough to look at the last stored row: a request that failed part
 * way through the tool loop leaves assistant and tool rows after the user's
 * turn, so the user message is no longer last. What marks a turn as answered is
 * an assistant message carrying actual text — bare tool-call turns have empty
 * content and represent work in progress, not a reply.
 *
 * Used to avoid showing the model the same instruction twice when a user
 * resends after an error.
 */
export function isResendOfUnansweredTurn(
  history: StoredChatMessage[],
  message: string
): boolean {
  let lastUserIndex = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex === -1) return false;
  if (history[lastUserIndex].content !== message) return false;

  return !history
    .slice(lastUserIndex + 1)
    .some((m) => m.role === "assistant" && (m.content ?? "").trim().length > 0);
}
