/**
 * GET /api/session/fields?sessionId=xxx
 * Returns current field state for a session (used for polling/sync)
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionFields } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  try {
    const fields = await getSessionFields(sessionId);
    return NextResponse.json({ fields });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
