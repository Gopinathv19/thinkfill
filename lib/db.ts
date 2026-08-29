/**
 * lib/db.ts
 * Neon PostgreSQL connection and all database operations for ThinkFill.
 */
import { neon } from "@neondatabase/serverless";
import type { FormField, FieldStatus, FieldType } from "./types";

// Lazy-initialise the SQL client
let _sql: ReturnType<typeof neon> | null = null;

function getSql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL environment variable is not set");
    _sql = neon(url);
  }
  return _sql;
}

// Helper: cast neon result to a plain array
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rows(result: unknown): any[] {
  return result as unknown[];
}

// ─── Schema initialisation ─────────────────────────────────────────────────

export async function initSchema() {
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL DEFAULT 'Demo User',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS user_memory (
      id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      field_key   TEXT NOT NULL,
      value       TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, field_key)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS form_sessions (
      id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      form_name   TEXT NOT NULL,
      total_pages INT NOT NULL DEFAULT 1,
      status      TEXT NOT NULL DEFAULT 'in-progress',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS form_fields (
      id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      session_id   TEXT NOT NULL REFERENCES form_sessions(id) ON DELETE CASCADE,
      field_key    TEXT NOT NULL,
      label        TEXT NOT NULL,
      field_type   TEXT NOT NULL DEFAULT 'text',
      value        TEXT NOT NULL DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'missing',
      section      TEXT NOT NULL DEFAULT 'General',
      page         INT NOT NULL DEFAULT 1,
      coord_x      FLOAT,
      coord_y      FLOAT,
      coord_w      FLOAT,
      coord_h      FLOAT,
      options      TEXT,
      source       TEXT,
      UNIQUE (session_id, field_key)
    )
  `;

  const demoUserId = process.env.DEMO_USER_ID ?? "demo-user-001";
  await sql`
    INSERT INTO users (id, name)
    VALUES (${demoUserId}, 'Demo User')
    ON CONFLICT (id) DO NOTHING
  `;
}

// ─── User Memory ───────────────────────────────────────────────────────────

export async function getMemory(userId: string, fieldKey: string) {
  const sql = getSql();
  const result = await sql`
    SELECT * FROM user_memory
    WHERE user_id = ${userId} AND field_key = ${fieldKey}
    LIMIT 1
  `;
  return rows(result)[0] ?? null;
}

export async function getAllMemory(userId: string) {
  const sql = getSql();
  const result = await sql`
    SELECT * FROM user_memory
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
  `;
  return rows(result);
}

export async function saveMemory(
  userId: string,
  fieldKey: string,
  value: string
) {
  const sql = getSql();
  const result = await sql`
    INSERT INTO user_memory (user_id, field_key, value)
    VALUES (${userId}, ${fieldKey}, ${value})
    ON CONFLICT (user_id, field_key)
    DO UPDATE SET value = ${value}, updated_at = NOW()
    RETURNING *
  `;
  return rows(result)[0];
}

// ─── Form Sessions ─────────────────────────────────────────────────────────

export async function createSession(
  userId: string,
  formName: string,
  totalPages: number
) {
  const sql = getSql();
  const result = await sql`
    INSERT INTO form_sessions (user_id, form_name, total_pages)
    VALUES (${userId}, ${formName}, ${totalPages})
    RETURNING *
  `;
  return rows(result)[0];
}

export async function getSession(sessionId: string) {
  const sql = getSql();
  const result = await sql`
    SELECT * FROM form_sessions WHERE id = ${sessionId} LIMIT 1
  `;
  return rows(result)[0] ?? null;
}

// ─── Form Fields ───────────────────────────────────────────────────────────

export async function bulkInsertFields(
  sessionId: string,
  fields: FormField[]
) {
  if (fields.length === 0) return;
  const sql = getSql();

  for (const f of fields) {
    await sql`
      INSERT INTO form_fields (
        session_id, field_key, label, field_type, value, status,
        section, page, coord_x, coord_y, coord_w, coord_h, options, source
      ) VALUES (
        ${sessionId}, ${f.id}, ${f.label}, ${f.type}, ${f.value},
        ${f.status}, ${f.section}, ${f.page},
        ${f.coordinates?.x ?? null}, ${f.coordinates?.y ?? null},
        ${f.coordinates?.width ?? null}, ${f.coordinates?.height ?? null},
        ${f.options ? JSON.stringify(f.options) : null},
        ${f.source ?? null}
      )
      ON CONFLICT (session_id, field_key) DO NOTHING
    `;
  }
}

export async function getSessionFields(sessionId: string): Promise<FormField[]> {
  const sql = getSql();
  const result = await sql`
    SELECT * FROM form_fields WHERE session_id = ${sessionId} ORDER BY page, section
  `;

  return rows(result).map((r) => ({
    id: r.field_key as string,
    label: r.label as string,
    type: r.field_type as FieldType,
    value: r.value as string,
    status: r.status as FieldStatus,
    section: r.section as string,
    page: r.page as number,
    coordinates:
      r.coord_x != null
        ? {
            x: r.coord_x as number,
            y: r.coord_y as number,
            width: r.coord_w as number,
            height: r.coord_h as number,
          }
        : undefined,
    options: r.options ? JSON.parse(r.options as string) : undefined,
    source: r.source as FormField["source"],
  }));
}

export async function updateFieldValue(
  sessionId: string,
  fieldKey: string,
  value: string,
  status: FieldStatus = "filled",
  source: FormField["source"] = "user"
) {
  const sql = getSql();
  const result = await sql`
    UPDATE form_fields
    SET value = ${value}, status = ${status}, source = ${source}
    WHERE session_id = ${sessionId} AND field_key = ${fieldKey}
    RETURNING *
  `;
  return rows(result)[0] ?? null;
}
