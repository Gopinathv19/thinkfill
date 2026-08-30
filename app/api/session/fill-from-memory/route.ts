/**
 * POST /api/session/fill-from-memory
 *
 * Fills every missing field that has a saved value, without involving the
 * agent. Backs the workspace's "Fill from profile" button.
 *
 * The agent has the same capability (`fill_from_memory`), but a deterministic
 * action should never be reachable *only* through a model: as a session's
 * context grows, a small model starts reporting the fill without performing
 * it. Both paths run the same code in lib/db.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { initSchema, getSession, fillFieldsFromMemory } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId } = body;
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  try {
    await initSchema();

    const session = await getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const userId = (session.user_id as string) ?? process.env.DEMO_USER_ID ?? "demo-user-001";
    const { filled, stillMissing } = await fillFieldsFromMemory(sessionId, userId);

    return NextResponse.json({
      success: true,
      filledCount: filled.length,
      filled,
      stillMissing,
    });
  } catch (err) {
    console.error("[POST /api/session/fill-from-memory]", err);
    return NextResponse.json({ error: "Could not fill from your profile" }, { status: 500 });
  }
}
