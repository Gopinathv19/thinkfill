/**
 * lib/tool-summary.ts
 * Turns a raw tool result into one line a person can read.
 *
 * The assistant panel used to print each tool's JSON payload verbatim, which
 * buried the conversation under hundreds of lines of field dumps. But hiding
 * tool activity entirely would be worse: watching the agent read the form,
 * match the profile and fill fields is the visible proof it is doing work
 * rather than just talking. So each step becomes a short sentence, with the
 * original payload still available behind a click.
 *
 * Pure and dependency-free so the phrasing can be tested without a browser.
 */

export type ToolStepKind = "read" | "fill" | "memory" | "error";

export interface ToolStep {
  kind: ToolStepKind;
  /** One-line summary, e.g. "Filled email address". */
  label: string;
  /** Optional supporting text, e.g. the value written. */
  detail?: string;
}

/**
 * Harness plumbing the user has no reason to see: TrueForge's tool-discovery
 * wrappers describe *how* the agent found a tool, not anything about the form.
 */
const HIDDEN_TOOLS = new Set([
  "list_tools",
  "get_tool_info",
  "call_tool",
  "get_current_datetime",
]);

/** "email-address" / "email_address" → "email address" */
function prettifyKey(key: string): string {
  return key.replace(/[-_]+/g, " ").trim();
}

function truncate(value: string, max = 60): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

type Payload = Record<string, unknown>;

function parsePayload(content: string): Payload | null {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" ? (parsed as Payload) : null;
  } catch {
    return null;
  }
}

/**
 * A tool result whose call we could not name — a save resumed after approval
 * arrives in a later turn than the message that requested it, so there is no
 * tool call to join it to. The payload shape is enough to recognise it.
 */
function inferToolName(payload: Payload): string | null {
  if ("field_key" in payload && "message" in payload) return "save_user_memory";
  if ("totalFields" in payload) return "get_form_state";
  if ("matchCount" in payload) return "find_memory_matches";
  if ("field_id" in payload) return "fill_form_field";
  if ("memory" in payload && "count" in payload) return "list_user_memory";
  if ("cleared" in payload) return "clear_all_form_fields";
  return null;
}

/**
 * Summarise one tool result. Returns null when the step should not be shown.
 */
export function summarizeToolStep(
  toolName: string | null | undefined,
  content: string
): ToolStep | null {
  if (toolName && HIDDEN_TOOLS.has(toolName)) return null;

  const payload = parsePayload(content);
  if (!payload) {
    // Non-JSON output is rare (a harness-level error string). Show it rather
    // than silently dropping something that may explain a failure.
    const text = content.trim();
    return text ? { kind: "read", label: truncate(text, 90) } : null;
  }

  const name = toolName && !HIDDEN_TOOLS.has(toolName) ? toolName : inferToolName(payload);

  // A transport- or harness-level failure carries an `error` and none of a
  // tool's own result fields. Tools that report their own failures (a field
  // that could not be written, say) keep `field_id`/`field_key` and are left
  // to the branches below, which can name what actually failed.
  const hasToolResultShape = "field_id" in payload || "field_key" in payload;
  if (payload.error !== undefined && !hasToolResultShape) {
    const detail =
      typeof payload.error === "string" ? payload.error : JSON.stringify(payload.error);
    return { kind: "error", label: "A step failed", detail: truncate(detail, 120) };
  }

  switch (name) {
    case "get_form_state": {
      const total = Number(payload.totalFields ?? 0);
      const filled = Number(payload.filledCount ?? 0);
      return { kind: "read", label: `Checked the form — ${filled} of ${total} filled` };
    }

    case "find_memory_matches": {
      const matches = Number(payload.matchCount ?? 0);
      return {
        kind: "memory",
        label:
          matches > 0
            ? `Found ${matches} ${matches === 1 ? "value" : "values"} in your profile`
            : "No saved values matched the remaining fields",
      };
    }

    case "fill_form_field": {
      const field = prettifyKey(String(payload.field_id ?? "a field"));
      if (payload.success === false) {
        return {
          kind: "error",
          label: `Could not fill ${field}`,
          detail: typeof payload.error === "string" ? truncate(payload.error, 120) : undefined,
        };
      }
      return {
        kind: "fill",
        label: `Filled ${field}`,
        detail: payload.value != null ? truncate(String(payload.value)) : undefined,
      };
    }

    case "save_user_memory": {
      const key = prettifyKey(String(payload.field_key ?? "a value"));
      if (payload.success === false) {
        return { kind: "error", label: `Could not save ${key} to your profile` };
      }
      return {
        kind: "memory",
        label: `Saved ${key} to your profile`,
        detail: payload.value != null ? truncate(String(payload.value)) : undefined,
      };
    }

    case "clear_form_field": {
      const field = prettifyKey(String(payload.field_id ?? "a field"));
      if (payload.success === false) {
        return {
          kind: "error",
          label: `Could not clear ${field}`,
          detail: typeof payload.error === "string" ? truncate(payload.error, 120) : undefined,
        };
      }
      return { kind: "fill", label: `Cleared ${field}` };
    }

    case "clear_all_form_fields": {
      const cleared = Number(payload.cleared ?? 0);
      return {
        kind: "fill",
        label:
          cleared === 0
            ? "Nothing to clear — the form was already empty"
            : `Cleared all ${cleared} ${cleared === 1 ? "field" : "fields"}`,
      };
    }

    case "get_user_memory": {
      const key = prettifyKey(String(payload.field_key ?? "a value"));
      return {
        kind: "memory",
        label: payload.found ? `Looked up ${key} — found` : `Looked up ${key} — not saved yet`,
      };
    }

    case "list_user_memory": {
      const count = Number(payload.count ?? 0);
      return {
        kind: "memory",
        label: `Read your profile — ${count} saved ${count === 1 ? "value" : "values"}`,
      };
    }

    default:
      // An unrecognised tool still did something; name it rather than dumping
      // its payload into the conversation.
      return { kind: "read", label: toolName ? `Ran ${prettifyKey(toolName)}` : "Completed a step" };
  }
}
