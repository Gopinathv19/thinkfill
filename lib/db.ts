/**
 * lib/db.ts
 * Neon PostgreSQL connection and all database operations for ThinkFill.
 */
import { neon } from "@neondatabase/serverless";
import type { FormField, FieldStatus, FieldType } from "./types";
import { canonicalizeKey, resolveMemoryKey } from "./memory-keys";

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

/**
 * Schema creation is idempotent but not free — every statement is a network
 * round trip to Neon. API routes call this defensively on each request, so the
 * work is memoised per process and only ever runs once.
 */
let _schemaReady: Promise<void> | null = null;

export function initSchema(): Promise<void> {
  if (!_schemaReady) {
    _schemaReady = createSchema().catch((err) => {
      // Don't cache a failure — the next request should be able to retry.
      _schemaReady = null;
      throw err;
    });
  }
  return _schemaReady;
}

async function createSchema() {
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

  // The TrueForge harness session and connector registered for this form.
  // Created lazily on the first chat turn; see lib/trueforge.ts. `tf_model`
  // records which model the session's agent spec was built with, so a change
  // to TRUEFORGE_MODEL can be pushed to sessions that already exist.
  await sql`
    ALTER TABLE form_sessions
      ADD COLUMN IF NOT EXISTS tf_session_id TEXT,
      ADD COLUMN IF NOT EXISTS mcp_server_name TEXT,
      ADD COLUMN IF NOT EXISTS tf_model TEXT
  `;

  // The uploaded document itself lives in the PDF store (see lib/pdf-store.ts),
  // keyed by session id. Only its metadata is kept here: a non-null filename
  // means the workspace has something to render and export.
  await sql`
    ALTER TABLE form_sessions
      ADD COLUMN IF NOT EXISTS document_filename TEXT,
      ADD COLUMN IF NOT EXISTS document_size INT
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

  // Full provider-shaped conversation history, so the agent keeps its tool
  // results across turns and a session survives a page reload.
  await sql`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id            BIGSERIAL PRIMARY KEY,
      session_id    TEXT NOT NULL REFERENCES form_sessions(id) ON DELETE CASCADE,
      role          TEXT NOT NULL,
      content       TEXT,
      tool_calls    JSONB,
      tool_call_id  TEXT,
      tool_name     TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS chat_messages_session_idx
      ON chat_messages (session_id, id)
  `;

  // Human-in-the-loop gate. Nothing is written to user_memory without an
  // approved row here, so the agent cannot persist data on its own say-so.
  await sql`
    CREATE TABLE IF NOT EXISTS memory_approvals (
      id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      session_id   TEXT NOT NULL REFERENCES form_sessions(id) ON DELETE CASCADE,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      field_key    TEXT NOT NULL,
      label        TEXT NOT NULL,
      value        TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at  TIMESTAMPTZ
    )
  `;

  // When an approval was raised by TrueForge pausing a save_user_memory tool
  // call, these identify the paused call so the user's decision can resume it.
  await sql`
    ALTER TABLE memory_approvals
      ADD COLUMN IF NOT EXISTS tf_thread_id TEXT,
      ADD COLUMN IF NOT EXISTS tf_tool_call_id TEXT
  `;

  const demoUserId = process.env.DEMO_USER_ID ?? "demo-user-001";
  await sql`
    INSERT INTO users (id, name)
    VALUES (${demoUserId}, 'Demo User')
    ON CONFLICT (id) DO NOTHING
  `;
}

// ─── User Memory ───────────────────────────────────────────────────────────

/**
 * Memory is always keyed canonically so a value saved while filling one form is
 * found while filling another that names the same field differently. Callers
 * may pass a raw field id or label; it is normalised here.
 */
export async function getMemory(userId: string, fieldKey: string) {
  const sql = getSql();
  const key = canonicalizeKey(fieldKey);
  const result = await sql`
    SELECT * FROM user_memory
    WHERE user_id = ${userId} AND field_key = ${key}
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
  const key = canonicalizeKey(fieldKey);
  const result = await sql`
    INSERT INTO user_memory (user_id, field_key, value)
    VALUES (${userId}, ${key}, ${value})
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

/** Record that a session's PDF was stored, and under what name/size. */
export async function setSessionDocument(
  sessionId: string,
  filename: string,
  size: number
) {
  const sql = getSql();
  await sql`
    UPDATE form_sessions
    SET document_filename = ${filename},
        document_size = ${size},
        updated_at = NOW()
    WHERE id = ${sessionId}
  `;
}

/**
 * Delete a session and everything hanging off it.
 *
 * form_fields, chat_messages and memory_approvals all declare
 * ON DELETE CASCADE, so this one statement clears them too. The stored PDF and
 * the TrueForge session live outside Postgres and are removed by the caller
 * (see DELETE /api/sessions/[sessionId]).
 *
 * Returns the deleted row, or null if it was already gone.
 */
export async function deleteSession(sessionId: string) {
  const sql = getSql();
  const result = await sql`
    DELETE FROM form_sessions WHERE id = ${sessionId} RETURNING *
  `;
  return rows(result)[0] ?? null;
}

export async function setSessionTrueForgeRefs(
  sessionId: string,
  tfSessionId: string,
  mcpServerName: string,
  model: string
) {
  const sql = getSql();
  await sql`
    UPDATE form_sessions
    SET tf_session_id = ${tfSessionId},
        mcp_server_name = ${mcpServerName},
        tf_model = ${model},
        updated_at = NOW()
    WHERE id = ${sessionId}
  `;
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
    memoryKey: resolveMemoryKey(r.label as string, r.field_key as string)?.key ?? null,
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

// ─── Chat history ──────────────────────────────────────────────────────────

/**
 * A conversation turn in provider (OpenAI-compatible) shape.
 *
 * Assistant turns that requested tools keep their `toolCalls`, and each tool
 * result keeps its `toolCallId`. Persisting the full shape — rather than just
 * role and content — is what lets the agent remember on turn 5 what it already
 * looked up on turn 2, instead of re-running every tool from scratch.
 */
/**
 * Clear one field, or every field in the session when `fieldKey` is omitted.
 *
 * Clearing is not the same as filling with an empty string: the row has to go
 * back to `missing` with no source, or the navigator keeps counting it as
 * complete and find_memory_matches skips it as already answered.
 *
 * Returns how many fields were actually cleared, so the caller can tell the
 * user "cleared 8 fields" rather than guessing.
 */
export async function clearFieldValues(
  sessionId: string,
  fieldKey?: string
): Promise<number> {
  const sql = getSql();
  const result = fieldKey
    ? await sql`
        UPDATE form_fields
        SET value = '', status = 'missing', source = NULL
        WHERE session_id = ${sessionId} AND field_key = ${fieldKey}
        RETURNING id
      `
    : await sql`
        UPDATE form_fields
        SET value = '', status = 'missing', source = NULL
        WHERE session_id = ${sessionId}
          AND (value <> '' OR status <> 'missing')
        RETURNING id
      `;
  return rows(result).length;
}

export interface StoredChatMessage {
  id: number;
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  toolCalls: unknown[] | null;
  toolCallId: string | null;
  toolName: string | null;
  createdAt: string;
}

export interface NewChatMessage {
  role: StoredChatMessage["role"];
  content?: string | null;
  toolCalls?: unknown[] | null;
  toolCallId?: string | null;
  toolName?: string | null;
}

export async function appendChatMessages(
  sessionId: string,
  messages: NewChatMessage[]
): Promise<void> {
  if (messages.length === 0) return;
  const sql = getSql();

  // One multi-row insert rather than a round trip per message.
  const values = messages.map((m) => [
    sessionId,
    m.role,
    m.content ?? null,
    m.toolCalls ? JSON.stringify(m.toolCalls) : null,
    m.toolCallId ?? null,
    m.toolName ?? null,
  ]);

  await sql(
    `INSERT INTO chat_messages (session_id, role, content, tool_calls, tool_call_id, tool_name)
     VALUES ${values
       .map(
         (_, i) =>
           `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}::jsonb, $${i * 6 + 5}, $${i * 6 + 6})`
       )
       .join(", ")}`,
    values.flat()
  );
}

export async function getChatMessages(
  sessionId: string,
  limit = 200
): Promise<StoredChatMessage[]> {
  const sql = getSql();
  // Take the most recent `limit` rows, then restore chronological order.
  const result = await sql`
    SELECT * FROM (
      SELECT * FROM chat_messages
      WHERE session_id = ${sessionId}
      ORDER BY id DESC
      LIMIT ${limit}
    ) recent
    ORDER BY id ASC
  `;

  return rows(result).map((r) => ({
    id: Number(r.id),
    role: r.role as StoredChatMessage["role"],
    content: (r.content as string | null) ?? null,
    toolCalls: (r.tool_calls as unknown[] | null) ?? null,
    toolCallId: (r.tool_call_id as string | null) ?? null,
    toolName: (r.tool_name as string | null) ?? null,
    createdAt: String(r.created_at),
  }));
}

// ─── Memory approvals (human-in-the-loop gate) ─────────────────────────────

export interface MemoryApproval {
  id: string;
  sessionId: string;
  userId: string;
  fieldKey: string;
  label: string;
  value: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  resolvedAt: string | null;
  /** Set when the approval is a TrueForge tool call paused for the user. */
  tfThreadId: string | null;
  tfToolCallId: string | null;
}

function toApproval(r: Record<string, unknown>): MemoryApproval {
  return {
    id: r.id as string,
    sessionId: r.session_id as string,
    userId: r.user_id as string,
    fieldKey: r.field_key as string,
    label: r.label as string,
    value: r.value as string,
    status: r.status as MemoryApproval["status"],
    createdAt: String(r.created_at),
    resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
    tfThreadId: (r.tf_thread_id as string | null) ?? null,
    tfToolCallId: (r.tf_tool_call_id as string | null) ?? null,
  };
}

export async function createMemoryApproval(
  sessionId: string,
  userId: string,
  fieldKey: string,
  label: string,
  value: string,
  tfRefs?: { threadId: string; toolCallId: string }
): Promise<MemoryApproval> {
  const sql = getSql();
  const key = canonicalizeKey(fieldKey);
  const result = await sql`
    INSERT INTO memory_approvals (session_id, user_id, field_key, label, value, tf_thread_id, tf_tool_call_id)
    VALUES (${sessionId}, ${userId}, ${key}, ${label}, ${value},
            ${tfRefs?.threadId ?? null}, ${tfRefs?.toolCallId ?? null})
    RETURNING *
  `;
  return toApproval(rows(result)[0]);
}

export async function getPendingApprovals(sessionId: string): Promise<MemoryApproval[]> {
  const sql = getSql();
  const result = await sql`
    SELECT * FROM memory_approvals
    WHERE session_id = ${sessionId} AND status = 'pending'
    ORDER BY created_at ASC
  `;
  return rows(result).map(toApproval);
}

/**
 * Record the user's decision and, on approval, perform the write.
 *
 * The status transition is guarded by `status = 'pending'` in the WHERE clause,
 * so a replayed or double-clicked request resolves to null instead of writing
 * to memory twice. Returns null if the approval does not exist or was already
 * decided.
 */
export async function resolveMemoryApproval(
  approvalId: string,
  decision: "approved" | "rejected"
): Promise<MemoryApproval | null> {
  const sql = getSql();
  const result = await sql`
    UPDATE memory_approvals
    SET status = ${decision}, resolved_at = NOW()
    WHERE id = ${approvalId} AND status = 'pending'
    RETURNING *
  `;
  const row = rows(result)[0];
  if (!row) return null;

  const approval = toApproval(row);
  if (decision === "approved") {
    await saveMemory(approval.userId, approval.fieldKey, approval.value);
  }
  return approval;
}
