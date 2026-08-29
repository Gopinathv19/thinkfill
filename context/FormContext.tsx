"use client";
/**
 * context/FormContext.tsx
 * Shared state for the form workspace — all three panels read/write from here.
 */
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { FormField, FormSection, ChatMessage, PendingApproval } from "@/lib/types";

// ─── Context shape ────────────────────────────────────────────────────────────

interface FormContextValue {
  // Session
  sessionId: string | null;
  formName: string;
  pdfFile: File | null;
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

  // Approval
  pendingApproval: PendingApproval | null;

  // Actions
  uploadPdf: (file: File) => Promise<void>;
  setActiveField: (fieldId: string | null) => void;
  sendMessage: (content: string) => Promise<void>;
  approveMemorySave: () => Promise<void>;
  rejectMemorySave: () => void;
  refreshFields: () => Promise<void>;
  resetSession: () => void;
}

const FormContext = createContext<FormContextValue | null>(null);

export function useFormContext() {
  const ctx = useContext(FormContext);
  if (!ctx) throw new Error("useFormContext must be used inside FormProvider");
  return ctx;
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

// ─── Provider ─────────────────────────────────────────────────────────────────

export function FormProvider({ children }: { children: React.ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [formName, setFormName] = useState<string>("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
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

  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);

  // Ref so we don't need sessionId in every callback's dependency array
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // Revoke old object URL on change
  useEffect(() => {
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
  }, [pdfUrl]);

  // ─── Upload PDF ─────────────────────────────────────────────────────────

  const uploadPdf = useCallback(async (file: File) => {
    setIsLoading(true);
    setUploadError(null);
    setMessages([]);
    setFields([]);
    setSections([]);
    setActiveFieldId(null);
    setCompletionPercent(0);

    // Create a local object URL so react-pdf can render it
    const url = URL.createObjectURL(file);
    setPdfFile(file);
    setPdfUrl(url);

    try {
      const fd = new FormData();
      fd.append("pdf", file);

      const res = await fetch("/api/pdf/extract", { method: "POST", body: fd });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? "Failed to extract PDF");

      setSessionId(data.sessionId);
      setFormName(data.formName);
      setTotalPages(data.totalPages);

      const flds: FormField[] = data.fields;
      setFields(flds);
      setSections(buildSections(flds));
      setCompletionPercent(calcCompletion(flds));

      // Welcome message from assistant
      setMessages([
        {
          id: makeId(),
          role: "assistant",
          content: `I've loaded **${data.formName}** and found **${flds.length} fields** (${flds.filter(f => f.status === "missing").length} need to be filled). Let me help you fill them out. Type **"start"** to begin, or click any field in the navigator.`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      setUploadError(String(err));
      setPdfUrl(null);
      setPdfFile(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ─── Refresh fields from server ─────────────────────────────────────────

  const refreshFields = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const res = await fetch(`/api/session/fields?sessionId=${sid}`);
      const data = await res.json();
      if (data.fields) {
        setFields(data.fields);
        setSections(buildSections(data.fields));
        setCompletionPercent(calcCompletion(data.fields));
      }
    } catch {
      // silent — best effort
    }
  }, []);

  // ─── Send chat message to agent ─────────────────────────────────────────

  const sendMessage = useCallback(
    async (content: string) => {
      const sid = sessionIdRef.current;
      if (!sid) return;

      const userMsg: ChatMessage = {
        id: makeId(),
        role: "user",
        content,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsChatLoading(true);

      try {
        // Build message history for the API (last 20 messages to stay within context)
        const history = [...messages.slice(-20), userMsg].map((m) => ({
          role: m.role === "tool" ? "user" : m.role,
          content: m.content,
        }));

        const res = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history, sessionId: sid }),
        });

        const data = await res.json();

        // Add tool call messages for visibility
        if (data.toolCalls?.length) {
          for (const tc of data.toolCalls) {
            const toolMsg: ChatMessage = {
              id: makeId(),
              role: "tool",
              content: `Tool: **${tc.tool}**\n\`\`\`json\n${JSON.stringify(tc.result, null, 2)}\n\`\`\``,
              timestamp: new Date().toISOString(),
              toolName: tc.tool,
              toolResult: tc.result,
            };
            setMessages((prev) => [...prev, toolMsg]);
          }
        }

        // Assistant reply
        if (data.message) {
          const assistantMsg: ChatMessage = {
            id: makeId(),
            role: "assistant",
            content: data.message,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMsg]);

          // Check if agent is asking to save memory
          const lc = data.message.toLowerCase();
          if (
            (lc.includes("save") || lc.includes("remember")) &&
            (lc.includes("memory") || lc.includes("profile") || lc.includes("future"))
          ) {
            // Extract what might be saved from the last tool call
            const fillCalls = data.toolCalls?.filter(
              (tc: { tool: string; args: { field_id?: string; value?: string } }) => tc.tool === "fill_form_field"
            );
            if (fillCalls?.length) {
              const last = fillCalls[fillCalls.length - 1];
              setPendingApproval({
                fieldKey: last.args.field_id,
                value: last.args.value,
                label: last.args.field_id?.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
              });
            }
          }
        }

        // Refresh field states after agent actions
        await refreshFields();
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: makeId(),
            role: "assistant",
            content: `Sorry, I encountered an error: ${String(err)}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      } finally {
        setIsChatLoading(false);
      }
    },
    [messages, refreshFields]
  );

  // ─── Memory approval ────────────────────────────────────────────────────

  const approveMemorySave = useCallback(async () => {
    if (!pendingApproval) return;
    try {
      await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: "save_user_memory",
          params: { field_key: pendingApproval.fieldKey, value: pendingApproval.value },
        }),
      });

      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: "assistant",
          content: `✅ I've saved your **${pendingApproval.label}** to your profile. It will be used to fill future forms automatically.`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch {
      // silent
    } finally {
      setPendingApproval(null);
    }
  }, [pendingApproval]);

  const rejectMemorySave = useCallback(() => {
    setMessages((prev) => [
      ...prev,
      {
        id: makeId(),
        role: "assistant",
        content: `Understood — I won't save that to your profile. You can always update your preferences later.`,
        timestamp: new Date().toISOString(),
      },
    ]);
    setPendingApproval(null);
  }, []);

  // ─── Reset ──────────────────────────────────────────────────────────────

  const resetSession = useCallback(() => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setSessionId(null);
    setFormName("");
    setPdfFile(null);
    setPdfUrl(null);
    setTotalPages(1);
    setFields([]);
    setSections([]);
    setActiveFieldId(null);
    setCompletionPercent(0);
    setMessages([]);
    setPendingApproval(null);
    setUploadError(null);
  }, [pdfUrl]);

  return (
    <FormContext.Provider
      value={{
        sessionId,
        formName,
        pdfFile,
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
        pendingApproval,
        uploadPdf,
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
