/**
 * GET /api/session/pdf?sessionId=xxx
 *
 * Serves the original uploaded PDF for a session. This is what the workspace
 * viewer renders and what the export reads before stamping field values onto
 * it — both used to depend on the `File` object held by the browser tab that
 * did the upload, which is gone the moment the user navigates or reloads.
 *
 * Blobs are stored privately, so they are streamed through here rather than
 * handed to the browser as a storage URL: a filled form is somebody's identity
 * document, and a public URL would outlive any session check.
 */
import { NextRequest, NextResponse } from "next/server";
import { initSchema, getSession } from "@/lib/db";
import { readPdf } from "@/lib/pdf-store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  try {
    await initSchema();

    const session = await getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const stored = await readPdf(sessionId);
    if (!stored) {
      return NextResponse.json(
        {
          error:
            "No document is stored for this session. Sessions created before documents were kept have only their extracted fields.",
        },
        { status: 404 }
      );
    }

    const filename = (session.document_filename as string) ?? "form.pdf";
    const headers = new Headers({
      "Content-Type": "application/pdf",
      // `inline` so the viewer renders it rather than triggering a download.
      "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
      // A session's original upload never changes, but it is private, so allow
      // caching only in the user's own browser.
      "Cache-Control": "private, max-age=3600",
    });
    if (stored.size != null) headers.set("Content-Length", String(stored.size));

    return new Response(stored.body as BodyInit, { headers });
  } catch (err) {
    console.error("[GET /api/session/pdf]", err);
    return NextResponse.json({ error: "Could not load the document" }, { status: 500 });
  }
}
