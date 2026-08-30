/**
 * Tests for provider-failure reporting.
 *
 * Run with: npm test
 *
 * When a model provider throttles or hangs, the raw error is plumbing — the
 * user saw "TrueForge turn failed: Request failed (429):" and had no idea what
 * to do. These cases pin the mapping from each failure mode to advice a person
 * can act on, so a future refactor of the error strings cannot silently
 * regress it back to opaque text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeTurnFailure, TurnStalledError, unwrapToolCall } from "./trueforge";

test("rate limiting is reported as rate limiting, not a raw status code", () => {
  for (const raw of [
    new Error("Request failed (429): "),
    new Error('{"status":429,"title":"Too Many Requests"}'),
    new Error("Provider rate-limit exceeded"),
  ]) {
    const message = describeTurnFailure(raw);
    assert.match(message, /rate limiting/i);
    // The advice matters more than the diagnosis.
    assert.match(message, /try again|TRUEFORGE_MODEL/);
  }
});

test("a provider that never answers is distinguished from one that refuses", () => {
  const message = describeTurnFailure(
    new Error('Cannot connect to API: HTTP/2: "headers timeout after 300000"')
  );
  assert.match(message, /too long to respond/i);
});

test("a stalled turn keeps its own message, including the timeout used", () => {
  const message = describeTurnFailure(new TurnStalledError(90_000));
  assert.match(message, /90s/);
});

test("a sub-second timeout never renders as '0s'", () => {
  // Guards the rounding: an operator testing with a tiny value should still
  // get a sentence that reads correctly.
  assert.match(describeTurnFailure(new TurnStalledError(60)), /within 1s/);
});

test("an unreachable harness points at how to start it", () => {
  const message = describeTurnFailure(new Error("fetch failed: ECONNREFUSED 127.0.0.1:8790"));
  assert.match(message, /trueforge/i);
});

test("a rejected API key is reported as a credentials problem", () => {
  const message = describeTurnFailure(new Error("Request failed (401): Incorrect API key provided"));
  assert.match(message, /API key/i);
  assert.match(message, /Settings/i);
});

test("an unrecognised failure still surfaces its detail rather than swallowing it", () => {
  const message = describeTurnFailure(new Error("something entirely unexpected"));
  assert.match(message, /something entirely unexpected/);
});

/**
 * The harness lets the model reach an MCP tool either directly or through its
 * `call_tool` wrapper, and it picks per call. Missing the wrapped form meant
 * the paused `save_user_memory` went unrecognised: no approval card appeared
 * and every later message was rejected with "approvals or questions are
 * pending". Both shapes must resolve to the same tool.
 */
test("a wrapped tool call resolves to the tool that actually ran", () => {
  const { name, args } = unwrapToolCall("call_tool", {
    mcp_server: "thinkfill-abc",
    tool_name: "save_user_memory",
    input: { field_key: "email", value: "a@b.com" },
  } as unknown as Record<string, string>);

  assert.equal(name, "save_user_memory");
  assert.deepEqual(args, { field_key: "email", value: "a@b.com" });
});

test("a direct tool call passes through untouched", () => {
  const { name, args } = unwrapToolCall("fill_form_field", { field_id: "email", value: "x" });
  assert.equal(name, "fill_form_field");
  assert.deepEqual(args, { field_id: "email", value: "x" });
});

test("a malformed wrapper degrades instead of throwing", () => {
  // No tool_name: nothing to unwrap, so it stays as-is rather than crashing
  // the turn.
  assert.equal(unwrapToolCall("call_tool", { mcp_server: "x" }).name, "call_tool");
  // tool_name but no input: the tool is known, the arguments are simply empty.
  const missingInput = unwrapToolCall("call_tool", { tool_name: "get_form_state" });
  assert.equal(missingInput.name, "get_form_state");
  assert.deepEqual(missingInput.args, {});
});

/**
 * A small model handed an impossible instruction can spiral until it hits the
 * provider's output cap. The raw "max_tokens breached" tells the user nothing
 * they can act on, and the instinctive fix — raising the cap — just buys a
 * longer spiral.
 */
test("a runaway completion is explained in terms the user can act on", () => {
  for (const raw of [
    new Error("max_tokens breached"),
    new Error("This model's maximum context length is 131072 tokens"),
  ]) {
    const message = describeTurnFailure(raw);
    assert.doesNotMatch(message, /max_tokens/);
    assert.match(message, /rephras|specific field/i);
  }
});
