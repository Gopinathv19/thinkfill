/**
 * POST /api/agent/lobby
 *
 * The pre-upload conversation on /chat. Before a PDF exists there is no form
 * session, no MCP connector, and nothing to fill — so this runs a tool-less
 * TrueForge session whose only job is to understand what the user needs and
 * steer them toward uploading the form.
 *
 * The lobby is deliberately ephemeral: the transcript lives in the browser and
 * the TrueForge session id round-trips through the client. Once the PDF is
 * uploaded, the real agent (/api/agent/chat) takes over and everything from
 * that point is persisted per form session.
 *
 * Request:  { message: string, lobbySessionId?: string }
 * Response: { message: string, lobbySessionId: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { createLobbySession, runTurn, describeTurnFailure } from "@/lib/trueforge";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { message?: string; lobbySessionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message, lobbySessionId } = body;
  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  try {
    let tfSessionId = lobbySessionId ?? (await createLobbySession());

    let outcome;
    try {
      outcome = await runTurn(tfSessionId, [{ type: "user.message", content: message }]);
    } catch (err) {
      // A stored lobby id can outlive the TrueForge process (its state is
      // local). One retry on a fresh session covers a harness restart.
      if (!lobbySessionId) throw err;
      tfSessionId = await createLobbySession();
      outcome = await runTurn(tfSessionId, [{ type: "user.message", content: message }]);
    }

    return NextResponse.json({
      message:
        outcome.assistantText ??
        "Upload your PDF with the + button or drag it into the chat, and I'll take it from there.",
      lobbySessionId: tfSessionId,
    });
  } catch (err) {
    console.error("[agent/lobby] turn failed:", err);
    return NextResponse.json(
      {
        error: `${describeTurnFailure(err)} You can still upload your PDF — form analysis works independently.`,
      },
      { status: 503 }
    );
  }
}
