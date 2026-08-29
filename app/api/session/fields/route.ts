/**
 * GET /api/session/fields?sessionId=xxx
 * Returns current field state + session metadata for a session.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionFields, getSession } from "@/lib/db";

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
    return NextResponse.json({
      fields,
      formName: session?.form_name ?? null,
      totalPages: session?.total_pages ?? 1,
      status: session?.status ?? "in-progress",
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
