/**
 * GET /api/sessions
 * Returns recent form sessions for the current demo user.
 */
import { NextRequest, NextResponse } from "next/server";
import { initSchema } from "@/lib/db";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  try {
    await initSchema();

    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const sql = neon(url);

    const userId = process.env.DEMO_USER_ID ?? "demo-user-001";

    const result = await sql`
      SELECT
        fs.id,
        fs.form_name,
        fs.status,
        fs.created_at,
        fs.updated_at,
        COUNT(ff.id)::int AS total_fields,
        COUNT(CASE WHEN ff.status = 'filled' THEN 1 END)::int AS filled_fields
      FROM form_sessions fs
      LEFT JOIN form_fields ff ON ff.session_id = fs.id
      WHERE fs.user_id = ${userId}
      GROUP BY fs.id
      ORDER BY fs.updated_at DESC
      LIMIT 20
    `;

    const sessions = (result as unknown[]).map((r: unknown) => {
      const row = r as {
        id: string;
        form_name: string;
        status: string;
        created_at: string;
        updated_at: string;
        total_fields: number;
        filled_fields: number;
      };
      return {
        id: row.id,
        formName: row.form_name,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        totalFields: row.total_fields,
        filledFields: row.filled_fields,
      };
    });

    return NextResponse.json({ sessions });
  } catch (err) {
    console.error("[GET /api/sessions]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
