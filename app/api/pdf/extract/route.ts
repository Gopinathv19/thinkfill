/**
 * POST /api/pdf/extract
 * Accepts a multipart/form-data upload containing a PDF file.
 * Extracts AcroForm fields, creates a DB session, and returns structured field data.
 */
import { NextRequest, NextResponse } from "next/server";
import { extractPdfFields } from "@/lib/pdf";
import {
  initSchema,
  createSession,
  bulkInsertFields,
  appendChatMessages,
  setSessionDocument,
} from "@/lib/db";
import { savePdf, MAX_PDF_BYTES } from "@/lib/pdf-store";

// Disable the default body parser — we handle the stream manually
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // Ensure DB schema exists
    await initSchema();

    const formData = await req.formData();
    const file = formData.get("pdf") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No PDF file provided" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
    }

    // Read file bytes
    const arrayBuffer = await file.arrayBuffer();
    const pdfBytes = new Uint8Array(arrayBuffer);

    if (pdfBytes.byteLength > MAX_PDF_BYTES) {
      return NextResponse.json(
        {
          error: `That PDF is ${(pdfBytes.byteLength / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_PDF_BYTES / 1024 / 1024} MB — try a smaller file.`,
        },
        { status: 413 }
      );
    }

    // Extract fields
    const { formName, totalPages, fields } = await extractPdfFields(pdfBytes, file.name);

    // Create DB session
    const userId = process.env.DEMO_USER_ID ?? "demo-user-001";
    const session = await createSession(userId, formName, totalPages);

    // Persist extracted fields
    await bulkInsertFields(session.id, fields);

    // Keep the document itself: the workspace renders it and the export writes
    // values back onto it, long after the uploading tab is gone. A storage
    // failure must not strand a session that otherwise works, so it is logged
    // and the session continues without a preview.
    try {
      await savePdf(session.id, pdfBytes);
      await setSessionDocument(session.id, file.name, pdfBytes.byteLength);
    } catch (err) {
      console.error("[pdf/extract] could not store the document:", err);
    }

    // Seed the conversation server-side rather than in the browser, so the
    // opening message is still there when the session is reopened later.
    const missingCount = fields.filter((f) => f.status === "missing").length;
    await appendChatMessages(session.id, [
      {
        role: "assistant",
        content:
          fields.length === 0
            ? `I opened **${formName}**, but it has no fillable form fields — it looks like a flat PDF rather than an AcroForm. Try a form with interactive fields.`
            : `I've loaded **${formName}** and found **${fields.length} fields**, ${missingCount} of which still need a value. Say **"start"** and I'll fill in everything I already know from your profile, then ask you about the rest.`,
      },
    ]);

    return NextResponse.json({
      sessionId: session.id,
      formName,
      totalPages,
      fields,
    });
  } catch (err) {
    console.error("[pdf/extract] Error:", err);
    return NextResponse.json(
      { error: "Failed to process PDF", details: String(err) },
      { status: 500 }
    );
  }
}
