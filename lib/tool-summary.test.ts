/**
 * Tests for the agent-activity summaries shown in the assistant panel.
 *
 * Run with: npm test
 *
 * The panel previously printed each tool's JSON verbatim, which buried the
 * conversation under field dumps. These cases pin the two properties that
 * matter: harness plumbing stays hidden, and every real action reads as a
 * sentence about the user's form rather than a payload.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeToolStep } from "./tool-summary";

test("tool-discovery plumbing is hidden entirely", () => {
  for (const name of ["list_tools", "get_tool_info", "call_tool", "get_current_datetime"]) {
    assert.equal(summarizeToolStep(name, "{}"), null, `${name} should not be shown`);
  }
});

test("reading the form reports progress, not the field list", () => {
  const step = summarizeToolStep(
    "get_form_state",
    JSON.stringify({ totalFields: 12, filledCount: 4, missingCount: 8, fields: [] })
  );
  assert.equal(step?.label, "Checked the form — 4 of 12 filled");
});

test("memory matches are counted and pluralised", () => {
  const many = summarizeToolStep("find_memory_matches", JSON.stringify({ matchCount: 4 }));
  assert.equal(many?.label, "Found 4 values in your profile");

  const one = summarizeToolStep("find_memory_matches", JSON.stringify({ matchCount: 1 }));
  assert.equal(one?.label, "Found 1 value in your profile");

  const none = summarizeToolStep("find_memory_matches", JSON.stringify({ matchCount: 0 }));
  assert.match(none!.label, /No saved values/);
});

test("a filled field is named readably, with its value as detail", () => {
  const step = summarizeToolStep(
    "fill_form_field",
    JSON.stringify({ success: true, field_id: "email-address", value: "a@b.com" })
  );
  assert.equal(step?.label, "Filled email address");
  assert.equal(step?.detail, "a@b.com");
  assert.equal(step?.kind, "fill");
});

test("a long value is truncated so one step stays one line", () => {
  const step = summarizeToolStep(
    "fill_form_field",
    JSON.stringify({ success: true, field_id: "current-address", value: "x".repeat(200) })
  );
  assert.ok(step!.detail!.length <= 60, "detail should be truncated");
});

test("a failed step is flagged rather than reading like success", () => {
  const step = summarizeToolStep(
    "fill_form_field",
    JSON.stringify({ success: false, field_id: "city", error: "No field 'city' in this form." })
  );
  assert.equal(step?.kind, "error");
  assert.match(step!.label, /Could not fill city/);
});

/**
 * A save resumed after approval arrives in a later turn than the message that
 * requested it, so there is no tool call to join it to and the name is absent.
 * It used to render as a bare "tool" heading over raw JSON.
 */
test("an unnamed result is recognised from its shape", () => {
  const step = summarizeToolStep(
    null,
    JSON.stringify({ success: true, field_key: "annual_income", value: "5 lakhs", message: "Saved" })
  );
  assert.equal(step?.label, "Saved annual income to your profile");
  assert.equal(step?.kind, "memory");
});

test("non-JSON output is surfaced instead of dropped", () => {
  const step = summarizeToolStep("fill_form_field", "upstream connection reset");
  assert.match(step!.label, /upstream connection reset/);
});

test("an unknown tool is named rather than dumped", () => {
  const step = summarizeToolStep("some_new_tool", JSON.stringify({ ok: true }));
  assert.equal(step?.label, "Ran some new tool");
});

test("clearing one field reads as clearing, not filling", () => {
  const step = summarizeToolStep(
    "clear_form_field",
    JSON.stringify({ success: true, field_id: "phone-number", cleared: 1 })
  );
  assert.equal(step?.label, "Cleared phone number");
});

test("clearing the whole form reports how many fields went", () => {
  const many = summarizeToolStep("clear_all_form_fields", JSON.stringify({ success: true, cleared: 8 }));
  assert.equal(many?.label, "Cleared all 8 fields");

  const one = summarizeToolStep("clear_all_form_fields", JSON.stringify({ success: true, cleared: 1 }));
  assert.equal(one?.label, "Cleared all 1 field");

  // An empty form is a no-op, and saying "cleared 0 fields" reads as a failure.
  const none = summarizeToolStep("clear_all_form_fields", JSON.stringify({ success: true, cleared: 0 }));
  assert.match(none!.label, /already empty/);
});
