/**
 * DELETE /api/sessions/[sessionId]
 *
 * Removes a form session and everything it owns:
 *
 *  - the stored PDF (Vercel Blob or local disk — see lib/pdf-store.ts), so a
 *    deleted form stops costing storage and stops being retrievable;
 *  - the TrueForge harness session, so the agent's copy of the conversation
 *    goes too rather than lingering in the harness;
 *  - the database row, which cascades to fields, chat history and approvals.
 *
 * The external deletions run first and are best-effort: if the blob store or
 * the harness is unreachable, the user's delete still takes effect rather than
 * failing halfway. Anything skipped is reported back so it is visible instead
 * of silent.
 */
import { NextRequest, NextResponse } from "next/server";
import { initSchema, getSession, deleteSession } from "@/lib/db";
import { deletePdf } from "@/lib/pdf-store";
import { getTrueForgeClient } from "@/lib/trueforge";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  try {
    await initSchema();

    const session = await getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const warnings: string[] = [];

    if (session.document_filename) {
      try {
        await deletePdf(sessionId);
      } catch (err) {
        console.error(`[DELETE /api/sessions/${sessionId}] blob delete failed:`, err);
        warnings.push("The stored PDF could not be deleted.");
      }
    }

    const tfSessionId = session.tf_session_id as string | null;
    if (tfSessionId) {
      try {
        await getTrueForgeClient().sessions.delete(tfSessionId);
      } catch (err) {
        // A harness that is down, or a session already gone, must not block
        // the user's delete.
        console.error(`[DELETE /api/sessions/${sessionId}] TrueForge delete failed:`, err);
        warnings.push("The agent session could not be deleted from TrueForge.");
      }
    }

    const deleted = await deleteSession(sessionId);
    if (!deleted) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({
      deleted: true,
      sessionId,
      formName: deleted.form_name,
      ...(warnings.length ? { warnings } : {}),
    });
  } catch (err) {
    console.error(`[DELETE /api/sessions/${sessionId}]`, err);
    return NextResponse.json({ error: "Could not delete the session" }, { status: 500 });
  }
}
