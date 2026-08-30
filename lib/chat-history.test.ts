/**
 * Tests for conversation-history handling.
 *
 * These cover the retry path in particular, which is easy to get wrong: a
 * request that fails part way through the tool loop leaves rows *after* the
 * user's message, so "was this turn answered?" cannot be decided by looking at
 * the last row alone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { toProviderMessage, isResendOfUnansweredTurn } from "./chat-history";
import type { StoredChatMessage } from "./db";

let nextId = 1;
function row(partial: Partial<StoredChatMessage> & Pick<StoredChatMessage, "role">): StoredChatMessage {
  return {
    id: nextId++,
    content: null,
    toolCalls: null,
    toolCallId: null,
    toolName: null,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

const user = (content: string) => row({ role: "user", content });
const reply = (content: string) => row({ role: "assistant", content });
const toolRequest = () => row({ role: "assistant", content: "", toolCalls: [{ id: "c1" }] });
const toolResult = (name: string) =>
  row({ role: "tool", content: "{}", toolCallId: "c1", toolName: name });

// ─── toProviderMessage ─────────────────────────────────────────────────────

test("a tool result carries its tool_call_id", () => {
  assert.deepEqual(toProviderMessage(toolResult("get_form_state")), {
    role: "tool",
    tool_call_id: "c1",
    content: "{}",
  });
});

test("an assistant turn keeps its tool_calls", () => {
  const m = toProviderMessage(toolRequest());
  assert.equal(m.role, "assistant");
  assert.deepEqual(m.tool_calls, [{ id: "c1" }]);
});

test("null content becomes an empty string, which providers accept", () => {
  const m = toProviderMessage(row({ role: "assistant", content: null, toolCalls: [{ id: "c1" }] }));
  assert.equal(m.content, "");
});

test("a plain turn carries no tool fields", () => {
  assert.deepEqual(toProviderMessage(user("hello")), { role: "user", content: "hello" });
});

// ─── isResendOfUnansweredTurn ──────────────────────────────────────────────

test("an empty conversation is never a resend", () => {
  assert.equal(isResendOfUnansweredTurn([], "start"), false);
});

test("a different message is not a resend", () => {
  assert.equal(isResendOfUnansweredTurn([user("start")], "continue"), false);
});

test("repeating a turn that got a reply is a genuine new turn", () => {
  const history = [user("start"), reply("Which field first?")];
  assert.equal(isResendOfUnansweredTurn(history, "start"), false);
});

test("repeating a turn that got no reply at all is a resend", () => {
  assert.equal(isResendOfUnansweredTurn([user("start")], "start"), true);
});

test("a failure part way through the tool loop still counts as unanswered", () => {
  // The provider died after two tool rounds, so rows exist after the user's
  // message but none of them is an actual reply. This is the case the first
  // implementation got wrong.
  const history = [
    user("my name is Gopinath"),
    toolRequest(),
    toolResult("fill_form_field"),
    toolRequest(),
    toolResult("get_form_state"),
  ];
  assert.equal(isResendOfUnansweredTurn(history, "my name is Gopinath"), true);
});

test("an assistant turn with only whitespace does not count as a reply", () => {
  const history = [user("start"), row({ role: "assistant", content: "   " })];
  assert.equal(isResendOfUnansweredTurn(history, "start"), true);
});

test("only the most recent user turn is considered", () => {
  // "start" appears earlier and was answered; the live turn is a different one.
  const history = [user("start"), reply("ok"), user("next")];
  assert.equal(isResendOfUnansweredTurn(history, "start"), false);
  assert.equal(isResendOfUnansweredTurn(history, "next"), true);
});

test("the seeded welcome message does not make the first turn look answered", () => {
  const history = [reply("I've loaded your form."), user("start")];
  assert.equal(isResendOfUnansweredTurn(history, "start"), true);
});
