/**
 * GET /api/session/messages?sessionId=xxx
 *
 * Conversation history for a session, in the shape the UI renders.
 *
 * History is stored server-side rather than held in the browser, so reopening a
 * session from the sidebar restores the actual conversation — including which
 * tools the agent ran — instead of starting from a blank thread.
 */
import { NextRequest, NextResponse } from "next/server";
import { initSchema, getChatMessages } from "@/lib/db";
import type { ChatMessage } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  try {
    await initSchema();
    const stored = await getChatMessages(sessionId);

    const messages: ChatMessage[] = stored
      // System prompts and the assistant's bare tool-call turns carry no text
      // for the user to read; the tool result rows below cover what happened.
      .filter((m) => m.role !== "system")
      .filter((m) => m.role !== "assistant" || (m.content ?? "").trim().length > 0)
      .map((m) => {
        if (m.role === "tool") {
          let result: unknown = m.content;
          try {
            result = JSON.parse(m.content ?? "null");
          } catch {
            // Leave the raw string; a tool that returned non-JSON is still
            // worth showing.
          }
          // The tool's own output, verbatim. It used to be wrapped here in a
          // markdown code fence, which decided the presentation for the client
          // and — worse — meant anything trying to read the result had to
          // unwrap prose first (see lib/tool-summary.ts, which summarises it
          // into a readable line). Formatting belongs to the component.
          return {
            id: String(m.id),
            role: "tool" as const,
            content: m.content ?? "",
            timestamp: m.createdAt,
            toolName: m.toolName ?? undefined,
            toolResult: result,
          };
        }
        return {
          id: String(m.id),
          role: m.role as "user" | "assistant",
          content: m.content ?? "",
          timestamp: m.createdAt,
        };
      });

    return NextResponse.json({ messages });
  } catch (err) {
    console.error("[GET /api/session/messages]", err);
    return NextResponse.json({ error: "Could not load conversation" }, { status: 500 });
  }
}
