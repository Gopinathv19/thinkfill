/**
 * POST /api/pdf/extract
 * Accepts a multipart/form-data upload containing a PDF file.
 * Extracts AcroForm fields, creates a DB session, and returns structured field data.
 */
import { NextRequest, NextResponse } from "next/server";
import { extractPdfFields } from "@/lib/pdf";
import { initSchema, createSession, bulkInsertFields } from "@/lib/db";

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

    // Extract fields
    const { formName, totalPages, fields } = await extractPdfFields(pdfBytes, file.name);

    // Create DB session
    const userId = process.env.DEMO_USER_ID ?? "demo-user-001";
    const session = await createSession(userId, formName, totalPages);

    // Persist extracted fields
    await bulkInsertFields(session.id, fields);

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
