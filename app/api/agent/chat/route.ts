/**
 * POST /api/agent/chat
 * AI agent endpoint using NVIDIA NIM / any OpenAI-compatible provider.
 * Implements the form-filling agentic loop with MCP tool calls.
 *
 * Flow:
 *   1. Receive user message + session context
 *   2. Call LLM with system prompt + tool definitions
 *   3. If LLM wants to use a tool → execute it, add result, continue loop
 *   4. Return final assistant message + any tool calls made
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

// ─── LLM Tool definitions ─────────────────────────────────────────────────

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_form_state",
      description:
        "Returns the current state of all form fields including which are filled or missing.",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "Active form session ID" },
        },
        required: ["session_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_user_memory",
      description:
        "Retrieves a previously saved value from user memory. Always call this before asking the user for information.",
      parameters: {
        type: "object",
        properties: {
          field_key: {
            type: "string",
            description: "Memory key to look up (e.g. 'occupation', 'full_name', 'phone_number')",
          },
        },
        required: ["field_key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fill_form_field",
      description: "Fills a specific form field with a value.",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          field_id: { type: "string", description: "The field ID to fill" },
          value: { type: "string", description: "Value to set" },
          source: {
            type: "string",
            enum: ["memory", "user", "ai"],
            description: "Source of this value",
          },
        },
        required: ["session_id", "field_id", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_user_memory",
      description:
        "Saves a value to persistent user memory for reuse in future forms. Only call this after the user has explicitly approved saving.",
      parameters: {
        type: "object",
        properties: {
          field_key: { type: "string" },
          value: { type: "string" },
        },
        required: ["field_key", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_user_memory",
      description: "Returns all values saved in user memory.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

// ─── Tool executors ───────────────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, string>
): Promise<unknown> {
  switch (name) {
    case "get_form_state": {
      const fields = await getSessionFields(args.session_id);
      const missing = fields.filter((f) => f.status === "missing");
      const filled = fields.filter((f) => f.status === "filled");
      return {
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
        })),
        missingFields: missing.map((f) => ({ id: f.id, label: f.label })),
      };
    }

    case "get_user_memory": {
      const userId = process.env.DEMO_USER_ID ?? "demo-user-001";
      const record = await getMemory(userId, args.field_key);
      if (!record) return { found: false, field_key: args.field_key, value: null };
      return { found: true, field_key: args.field_key, value: record.value };
    }

    case "fill_form_field": {
      const updated = await updateFieldValue(
        args.session_id,
        args.field_id,
        args.value,
        "filled",
        (args.source as "memory" | "user" | "ai") ?? "ai"
      );
      return updated
        ? { success: true, field_id: args.field_id, value: args.value }
        : { success: false, error: `Field '${args.field_id}' not found` };
    }

    case "save_user_memory": {
      const userId = process.env.DEMO_USER_ID ?? "demo-user-001";
      await saveMemory(userId, args.field_key, args.value);
      return { success: true, field_key: args.field_key, value: args.value };
    }

    case "list_user_memory": {
      const userId = process.env.DEMO_USER_ID ?? "demo-user-001";
      const records = (await getAllMemory(userId)) as { field_key: string; value: string }[];
      return {
        count: records.length,
        memory: records.map((r) => ({ key: r.field_key, value: r.value })),
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  await initSchema();

  const { messages, sessionId } = await req.json() as {
    messages: Array<{ role: string; content: string }>;
    sessionId: string;
  };

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const baseUrl = process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
  const apiKey = process.env.NVIDIA_API_KEY ?? "";
  // Use a model that supports tool calling. Nemotron reasoning models do NOT support tools.
  // Fall back to llama-3.1-70b-instruct which has reliable tool support on NIM.
  const model = process.env.NVIDIA_MODEL ?? "meta/llama-3.1-70b-instruct";

  const systemPrompt = `You are ThinkFill, an intelligent form-filling assistant. Your job is to help users complete forms efficiently by using their saved memory and asking only for information that is truly missing.

IMPORTANT RULES:
1. ALWAYS call get_form_state first to understand what fields need to be filled.
2. For EACH missing field, call get_user_memory BEFORE asking the user.
3. If memory has the value → call fill_form_field immediately with source="memory".
4. If memory is missing → ask the user for that specific piece of information.
5. When the user provides information → call fill_form_field with source="user".
6. After filling a new field from user input → ask "Would you like me to save [field] to your profile for future forms?" Wait for explicit approval before calling save_user_memory.
7. Work through fields systematically, one at a time.
8. Always be concise and helpful. Show progress (e.g., "3 of 6 fields filled").

Current session ID: ${sessionId}`;

  // Build messages for the API
  const apiMessages = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  const toolCallLog: Array<{ tool: string; args: unknown; result: unknown }> = [];

  // Agentic loop — max 10 iterations to prevent infinite loops
  for (let iteration = 0; iteration < 10; iteration++) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: apiMessages,
        tools: TOOLS,
        tool_choice: "auto",
        max_tokens: 4096,       // larger budget for reasoning models
        temperature: 0.6,
        top_p: 0.95,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: `LLM API error: ${response.status}`, details: errText },
        { status: 500 }
      );
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const assistantMsg = choice?.message;

    if (!assistantMsg) {
      return NextResponse.json({ error: "No response from LLM" }, { status: 500 });
    }

    // Strip reasoning_content before pushing back into history — some NIM models
    // return it in the response but reject it when sent back in subsequent requests.
    const { reasoning_content: _rc, ...cleanAssistantMsg } = assistantMsg as Record<string, unknown>;
    void _rc; // suppress unused var lint
    apiMessages.push(cleanAssistantMsg as { role: string; content: string });

    // If no tool calls — this is the final response
    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      return NextResponse.json({
        message: assistantMsg.content,
        toolCalls: toolCallLog,
        finishReason: choice.finish_reason,
      });
    }

    // Execute all tool calls in this turn
    for (const tc of assistantMsg.tool_calls) {
      const toolName = tc.function.name;
      const toolArgs = JSON.parse(tc.function.arguments ?? "{}");
      const toolResult = await executeTool(toolName, toolArgs);

      toolCallLog.push({ tool: toolName, args: toolArgs, result: toolResult });

      // Add tool result to messages
      apiMessages.push({
        role: "tool",
        // @ts-expect-error tool_call_id is valid
        tool_call_id: tc.id,
        content: JSON.stringify(toolResult),
      });
    }

    // Continue loop — LLM will decide what to do next with the tool results
  }

  return NextResponse.json({
    message: "I've processed your request. Is there anything else you need?",
    toolCalls: toolCallLog,
    finishReason: "max_iterations",
  });
}
