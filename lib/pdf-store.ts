/**
 * lib/pdf-store.ts
 * Where an uploaded PDF's bytes live.
 *
 * The form workspace renders the original document and the export writes field
 * values back onto it, so the bytes have to outlive the browser tab that
 * uploaded them. Two backends sit behind one interface:
 *
 *  - **Vercel Blob** when `BLOB_READ_WRITE_TOKEN` is set. Blobs are stored
 *    `private`, because a filled form is somebody's identity document — a
 *    public blob URL would be readable by anyone who ever saw it. They are
 *    served through this app instead (see /api/session/pdf).
 *  - **Local disk** otherwise, under `THINKFILL_DATA_DIR` (default `.data`).
 *    This is what makes `git clone && npm run dev` work with no cloud account,
 *    which matters for anyone picking the project up.
 *
 * Nothing else in the app knows which backend is in play.
 */
import { put, del, get } from "@vercel/blob";
import { mkdir, readFile, writeFile, unlink, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * Largest PDF accepted on upload.
 *
 * Vercel Functions reject a request body over 4.5 MB outright
 * (FUNCTION_PAYLOAD_TOO_LARGE), and the upload passes through this app's own
 * route, so the ceiling is a platform fact rather than a preference. Held a
 * little under the limit to leave room for multipart encoding overhead, and
 * applied on both backends so behaviour is identical locally and deployed.
 *
 * Lifting it means switching to client uploads (browser → Blob directly, via a
 * token-exchange route), which is worth doing only if real forms exceed this.
 */
export const MAX_PDF_BYTES = 4 * 1024 * 1024;

export type PdfStoreBackend = "vercel-blob" | "local";

export function pdfStoreBackend(): PdfStoreBackend {
  return process.env.BLOB_READ_WRITE_TOKEN ? "vercel-blob" : "local";
}

/** Deterministic location for a session's document, so nothing needs storing. */
function blobPathname(sessionId: string): string {
  return `form-pdfs/${sessionId}.pdf`;
}

function localPath(sessionId: string): string {
  const root = process.env.THINKFILL_DATA_DIR ?? ".data";
  // Session ids are generated UUIDs, but resolve anyway so a crafted id can
  // never escape the data directory.
  const dir = resolve(process.cwd(), root, "pdfs");
  const path = resolve(dir, `${sessionId}.pdf`);
  if (!path.startsWith(dir)) throw new Error("Invalid session id");
  return path;
}

/** A stored PDF, ready to hand to a Response. */
export interface StoredPdf {
  body: ReadableStream<Uint8Array> | Uint8Array;
  size: number | null;
}

export async function savePdf(sessionId: string, bytes: Uint8Array): Promise<void> {
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error(
      `PDF is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_PDF_BYTES / 1024 / 1024} MB.`
    );
  }

  if (pdfStoreBackend() === "vercel-blob") {
    await put(blobPathname(sessionId), Buffer.from(bytes), {
      access: "private",
      contentType: "application/pdf",
      // The pathname is derived from the session id, so re-uploading the same
      // session must replace rather than fail.
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }

  const path = localPath(sessionId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

export async function readPdf(sessionId: string): Promise<StoredPdf | null> {
  if (pdfStoreBackend() === "vercel-blob") {
    const result = await get(blobPathname(sessionId), { access: "private" });
    if (!result || result.statusCode !== 200) return null;
    return { body: result.stream, size: result.blob.size ?? null };
  }

  try {
    const path = localPath(sessionId);
    const [bytes, info] = await Promise.all([readFile(path), stat(path)]);
    return { body: new Uint8Array(bytes), size: info.size };
  } catch {
    return null;
  }
}

/** Remove a session's document. Succeeds when there is nothing to remove. */
export async function deletePdf(sessionId: string): Promise<void> {
  if (pdfStoreBackend() === "vercel-blob") {
    await del(blobPathname(sessionId));
    return;
  }

  try {
    await unlink(localPath(sessionId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/** Where a session's PDF is served from. One shape for both backends. */
export function pdfUrlFor(sessionId: string): string {
  return `/api/session/pdf?sessionId=${encodeURIComponent(sessionId)}`;
}
