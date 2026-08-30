"use client";
/**
 * context/FormContext.tsx
 * Shared state for the form workspace — all three panels read/write from here.
 *
 * Conversation history is owned by the server (see /api/session/messages), not
 * held in this component. After every agent turn the thread is re-read from the
 * database, so tool calls and their results are never dropped and a session
 * survives a page reload.
 */
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { FormField, FormSection, ChatMessage, PendingApproval } from "@/lib/types";

// ─── Context shape ────────────────────────────────────────────────────────────

interface FormContextValue {
  // Session
  sessionId: string | null;
  formName: string;
  /** Server URL of the uploaded document, or null when none is stored. */
  pdfUrl: string | null;
  totalPages: number;
  isLoading: boolean;
  uploadError: string | null;

  // Fields
  fields: FormField[];
  sections: FormSection[];
  activeFieldId: string | null;
  completionPercent: number;

  // Chat
  messages: ChatMessage[];
  isChatLoading: boolean;

  // Approval — the head of the queue; resolving it reveals the next.
  pendingApproval: PendingApproval | null;

  // Actions
  rehydrateSession: (sessionId: string) => Promise<void>;
  setActiveField: (fieldId: string | null) => void;
  sendMessage: (content: string) => Promise<void>;
  approveMemorySave: () => Promise<void>;
  rejectMemorySave: () => Promise<void>;
  refreshFields: () => Promise<void>;
  resetSession: () => void;
}

const FormContext = createContext<FormContextValue | null>(null);

export function useFormContext() {
  const ctx = useContext(FormContext);
  if (!ctx) throw new Error("useFormContext must be used inside FormProvider");
  return ctx;
}

/**
 * Same context, but returns null outside a provider instead of throwing.
 * For components such as the top bar that render on pages with and without a
 * form session.
 */
export function useOptionalFormContext() {
  return useContext(FormContext);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSections(fields: FormField[]): FormSection[] {
  const map = new Map<string, FormField[]>();
  for (const f of fields) {
    const section = f.section || "General";
    if (!map.has(section)) map.set(section, []);
    map.get(section)!.push(f);
  }
  return Array.from(map.entries()).map(([title, flds]) => ({
    id: title.toLowerCase().replace(/\s+/g, "-"),
    title,
    fields: flds,
  }));
}

function calcCompletion(fields: FormField[]): number {
  if (!fields.length) return 0;
  const filled = fields.filter((f) => f.status === "filled").length;
  return Math.round((filled / fields.length) * 100);
}

function makeId(): string {
  return Math.random().toString(36).slice(2);
}

/** Pull a human-readable message out of an error response body. */
async function errorFrom(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return data.error ?? data.details ?? fallback;
  } catch {
    return fallback;
  }
}

interface ApprovalRow {
  id: string;
  fieldKey: string;
  label: string;
  value: string;
}

function toPendingApprovals(rows: ApprovalRow[] | undefined): PendingApproval[] {
  if (!rows?.length) return [];
  return rows.map((a) => ({
    id: a.id,
    fieldKey: a.fieldKey,
    label: a.label,
    value: a.value,
  }));
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function FormProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [formName, setFormName] = useState<string>("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [fields, setFields] = useState<FormField[]>([]);
  const [sections, setSections] = useState<FormSection[]>([]);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [completionPercent, setCompletionPercent] = useState(0);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);

  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);

  // Ref so callbacks don't need sessionId in their dependency arrays, which
  // would rebuild them (and risk stale closures) on every session change.
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  const applyFields = useCallback((flds: FormField[]) => {
    setFields(flds);
    setSections(buildSections(flds));
    setCompletionPercent(calcCompletion(flds));
  }, []);

  const clearSessionState = useCallback(() => {
    setMessages([]);
    setFields([]);
    setSections([]);
    setActiveFieldId(null);
    setCompletionPercent(0);
    setPendingApprovals([]);
    setUploadError(null);
  }, []);

  // ─── Server reads ───────────────────────────────────────────────────────

  const refreshFields = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const res = await fetch(`/api/session/fields?sessionId=${encodeURIComponent(sid)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.fields) applyFields(data.fields);
    } catch {
      // Best effort — the panel keeps showing the last known state.
    }
  }, [applyFields]);

  const refreshMessages = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const res = await fetch(`/api/session/messages?sessionId=${encodeURIComponent(sid)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.messages)) setMessages(data.messages);
    } catch {
      // Best effort.
    }
  }, []);

  const refreshApprovals = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const res = await fetch(`/api/approvals?sessionId=${encodeURIComponent(sid)}`);
      if (!res.ok) return;
      const data = await res.json();
      setPendingApprovals(toPendingApprovals(data.approvals));
    } catch {
      // Best effort.
    }
  }, []);

  // ─── Rehydrate a session (opened from /chat or the sidebar) ─────────────

  /**
   * Loads everything the workspace shows for a session.
   *
   * The document is addressed by session id rather than carried over from the
   * page that uploaded it, so it survives navigation from /chat and a reload —
   * which is the whole reason the bytes are stored server-side.
   */
  const rehydrateSession = useCallback(async (sid: string) => {
    setIsLoading(true);
    clearSessionState();
    setPdfUrl(null);

    try {
      const res = await fetch(`/api/session/fields?sessionId=${encodeURIComponent(sid)}`);
      if (!res.ok) throw new Error(await errorFrom(res, "Session not found"));
      const data = await res.json();

      setSessionId(sid);
      sessionIdRef.current = sid;
      if (data.formName) setFormName(data.formName);
      if (data.totalPages) setTotalPages(data.totalPages);
      applyFields(data.fields ?? []);
      setPdfUrl(
        data.hasDocument ? `/api/session/pdf?sessionId=${encodeURIComponent(sid)}` : null
      );

      await Promise.all([refreshMessages(), refreshApprovals()]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [applyFields, clearSessionState, refreshMessages, refreshApprovals]);

  // ─── Send chat message to agent ─────────────────────────────────────────

  const sendMessage = useCallback(
    async (content: string) => {
      const sid = sessionIdRef.current;
      if (!sid) return;

      // Show the user's message straight away; the authoritative thread is
      // re-read from the server once the agent has finished.
      const optimistic: ChatMessage = {
        id: makeId(),
        role: "user",
        content,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      setIsChatLoading(true);

      try {
        const res = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: content, sessionId: sid }),
        });

        if (!res.ok) {
          throw new Error(await errorFrom(res, `Request failed (${res.status})`));
        }

        const data = await res.json();
        setPendingApprovals(toPendingApprovals(data.pendingApprovals));

        // Replace the optimistic thread with the persisted one, which also
        // carries the agent's tool calls.
        await Promise.all([refreshMessages(), refreshFields()]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: makeId(),
            role: "assistant",
            content: `Sorry — ${err instanceof Error ? err.message : String(err)}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      } finally {
        setIsChatLoading(false);
      }
    },
    [refreshMessages, refreshFields]
  );

  // ─── Memory approval ────────────────────────────────────────────────────

  const resolveApproval = useCallback(
    async (decision: "approve" | "reject") => {
      const approval = pendingApprovals[0];
      if (!approval) return;

      // Drop it from the queue immediately so the card can't be submitted twice.
      setPendingApprovals((prev) => prev.slice(1));

      try {
        const res = await fetch("/api/approvals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approvalId: approval.id, decision }),
        });
        if (!res.ok) throw new Error(await errorFrom(res, "Could not record your decision"));

        await refreshMessages();
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: makeId(),
            role: "assistant",
            content: `Sorry — ${err instanceof Error ? err.message : String(err)}. Nothing was saved to your profile.`,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    },
    [pendingApprovals, refreshMessages]
  );

  const approveMemorySave = useCallback(() => resolveApproval("approve"), [resolveApproval]);
  const rejectMemorySave = useCallback(() => resolveApproval("reject"), [resolveApproval]);

  // ─── Reset ──────────────────────────────────────────────────────────────

  /**
   * Leave this form and start a new one.
   *
   * Uploads happen in the chat, so this navigates there rather than only
   * clearing state: the workspace URL still carries `?session=…`, and a
   * cleared session with a session id still in the address bar leaves the page
   * with nothing to render and nothing to load.
   */
  const resetSession = useCallback(() => {
    setSessionId(null);
    sessionIdRef.current = null;
    setFormName("");
    setPdfUrl(null);
    setTotalPages(1);
    clearSessionState();
    router.push("/chat");
  }, [clearSessionState, router]);

  return (
    <FormContext.Provider
      value={{
        sessionId,
        formName,
        pdfUrl,
        totalPages,
        isLoading,
        uploadError,
        fields,
        sections,
        activeFieldId,
        completionPercent,
        messages,
        isChatLoading,
        pendingApproval: pendingApprovals[0] ?? null,
        rehydrateSession,
        setActiveField: setActiveFieldId,
        sendMessage,
        approveMemorySave,
        rejectMemorySave,
        refreshFields,
        resetSession,
      }}
    >
      {children}
    </FormContext.Provider>
  );
}
