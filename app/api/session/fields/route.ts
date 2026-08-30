/**
 * GET   /api/session/fields?sessionId=xxx
 * Returns current field state + session metadata for a session.
 *
 * PATCH /api/session/fields
 * Writes one field value — used when the user edits a field directly in the
 * document view (agent-driven edits go through the MCP server instead).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionFields, getSession, updateFieldValue } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  try {
    const [fields, session] = await Promise.all([
      getSessionFields(sessionId),
      getSession(sessionId),
    ]);

    // A deleted session must read as gone, or the workspace renders an empty
    // shell for it instead of sending the user back to the chat.
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({
      fields,
      formName: session.form_name ?? null,
      totalPages: session.total_pages ?? 1,
      status: session.status ?? "in-progress",
      // Lets the workspace decide whether to render the viewer or say the
      // document is unavailable, without fetching the PDF to find out.
      hasDocument: Boolean(session.document_filename),
      documentName: (session.document_filename as string) ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  let body: { sessionId?: string; fieldId?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId, fieldId, value } = body;
  if (!sessionId || !fieldId || value === undefined) {
    return NextResponse.json(
      { error: "sessionId, fieldId, and value are required" },
      { status: 400 }
    );
  }

  try {
    const updated = await updateFieldValue(sessionId, fieldId, value, "filled", "user");
    if (!updated) {
      return NextResponse.json(
        { error: `Field '${fieldId}' not found in this session` },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, fieldId, value });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
