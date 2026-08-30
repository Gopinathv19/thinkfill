"use client";
/**
 * components/ChatInterface.tsx
 * The primary entry point of ThinkFill (/chat).
 *
 * One conversation, two phases:
 *
 *  1. **Lobby** (no PDF yet) — messages go to /api/agent/lobby, a tool-less
 *     TrueForge agent that understands what the user needs and steers them
 *     toward uploading the form (via the + button or drag & drop).
 *  2. **Form session** (PDF uploaded) — /api/pdf/extract creates the session,
 *     a kickoff message (carrying anything the user said in the lobby) is sent
 *     to the real agent, which immediately fills every field it knows from the
 *     saved profile. Further messages go to /api/agent/chat and persist
 *     server-side, so the thread is intact when the workspace opens.
 *
 * The workspace (/workspace?session=…) is where fields are reviewed, edited,
 * exported — and where memory-save approvals are decided, so the chat
 * navigates there whenever a turn ends with a pending approval.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Mic,
  ArrowUp,
  Plus,
  Sparkles,
  FileText,
  X,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { useRouter } from "next/navigation";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
}

let idCounter = 0;
function makeId(): string {
  return `${Date.now()}-${idCounter++}`;
}

async function errorFrom(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return data.error ?? fallback;
  } catch {
    return fallback;
  }
}

export default function ChatInterface() {
  const [input, setInput] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lobbySessionId, setLobbySessionId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Lobby messages the user typed before uploading — handed to the real agent
  // as context so nothing said pre-upload is lost.
  const lobbyIntentRef = useRef<string[]>([]);
  const router = useRouter();

  const greeting = getGreeting();
  const hasConversation = messages.length > 0;
  const isBusy = isUploading || isThinking;

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        200
      )}px`;
    }
  }, [input]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  const addMessage = useCallback((role: Message["role"], text: string) => {
    setMessages((prev) => [...prev, { id: makeId(), role, text }]);
  }, []);

  const goToWorkspace = useCallback(
    (sid?: string | null) => {
      const target = sid ?? sessionId;
      router.push(target ? `/workspace?session=${target}` : "/chat");
    },
    [router, sessionId]
  );

  // ── Agent calls ────────────────────────────────────────────────────────────

  /** Pre-upload: the tool-less lobby agent. */
  const sendToLobby = useCallback(
    async (text: string) => {
      lobbyIntentRef.current.push(text);
      setIsThinking(true);
      try {
        const res = await fetch("/api/agent/lobby", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, lobbySessionId }),
        });
        if (!res.ok) {
          throw new Error(await errorFrom(res, `Request failed (${res.status})`));
        }
        const data = await res.json();
        if (data.lobbySessionId) setLobbySessionId(data.lobbySessionId);
        addMessage("assistant", data.message);
      } catch (err) {
        addMessage(
          "assistant",
          `${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        setIsThinking(false);
      }
    },
    [lobbySessionId, addMessage]
  );

  /**
   * Post-upload: the real form agent. Returns the pending-approval count so
   * callers can route the user to the workspace, where approvals are decided.
   */
  const sendToAgent = useCallback(
    async (text: string, sid: string): Promise<number> => {
      setIsThinking(true);
      try {
        const res = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, sessionId: sid }),
        });
        if (!res.ok) {
          throw new Error(await errorFrom(res, `Request failed (${res.status})`));
        }
        const data = await res.json();
        if (data.message) addMessage("assistant", data.message);
        return Array.isArray(data.pendingApprovals) ? data.pendingApprovals.length : 0;
      } catch (err) {
        addMessage(
          "assistant",
          `Sorry — ${err instanceof Error ? err.message : String(err)}`
        );
        return 0;
      } finally {
        setIsThinking(false);
      }
    },
    [addMessage]
  );

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isBusy) return;
    setInput("");
    addMessage("user", text);

    if (sessionId) {
      const pending = await sendToAgent(text, sessionId);
      // Approvals are decided in the workspace — take the user there.
      if (pending > 0) goToWorkspace(sessionId);
    } else {
      await sendToLobby(text);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── PDF upload ─────────────────────────────────────────────────────────────

  const uploadFile = async (file: File) => {
    if (isBusy) return;
    setIsUploading(true);
    setUploadedFile(file);
    addMessage(
      "assistant",
      `I've received **"${file.name}"** — analysing the PDF and extracting form fields…`
    );

    try {
      const fd = new FormData();
      fd.append("pdf", file);
      const res = await fetch("/api/pdf/extract", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to process PDF");

      const sid: string = data.sessionId;
      setSessionId(sid);

      const missingCount = (data.fields as { status: string }[]).filter(
        (f) => f.status === "missing"
      ).length;
      addMessage(
        "assistant",
        `✅ Found **${data.fields.length} fields** in **${data.formName}** (${missingCount} to fill). Checking your saved profile…`
      );

      // Kick off the real agent with everything said in the lobby, so it fills
      // known fields immediately and asks for the first missing one.
      const intent = lobbyIntentRef.current.join(" ").trim();
      const kickoff = intent
        ? `I've uploaded the form. Context from before the upload: ${intent}. Please fill in everything you already know from my profile, then ask me for whatever is still missing.`
        : `I've uploaded the form. Please fill in everything you already know from my profile, then ask me for whatever is still missing.`;
      const pending = await sendToAgent(kickoff, sid);
      if (pending > 0) goToWorkspace(sid);
    } catch (err) {
      setUploadedFile(null);
      setSessionId(null);
      addMessage(
        "assistant",
        `Sorry, I couldn't process that PDF: ${err instanceof Error ? err.message : String(err)}. Please try another file.`
      );
    } finally {
      setIsUploading(false);
    }
  };

  const acceptFile = (file: File | undefined) => {
    if (!file) return;
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      uploadFile(file);
    } else {
      addMessage("assistant", "That doesn't look like a PDF — please upload a .pdf file.");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    acceptFile(e.target.files?.[0]);
    e.target.value = ""; // allow re-selecting the same file
  };

  // Drag & drop anywhere on the chat — replaces the old standalone dropzone page.
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (sessionId || isBusy) return;
    acceptFile(e.dataTransfer.files?.[0]);
  };

  // ── Input box ────────────────────────────────────────────────────────────────
  const inputBox = (
    <div className="w-full max-w-2xl mx-auto">
      <div
        className={`relative rounded-2xl border transition-all duration-200 bg-white shadow-sm
          ${isFocused
            ? "border-[#8b5cf6] shadow-[0_0_0_3px_rgba(139,92,246,0.12)]"
            : "border-[#d8d0ee]"
          }`}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={
            sessionId
              ? "Answer the agent or ask about your form…"
              : "Describe what you need to fill out, or drop a PDF here"
          }
          rows={1}
          className="w-full resize-none bg-transparent px-4 pt-4 pb-2 text-[#2d1b69] placeholder-[#c4b8e8] text-sm outline-none leading-relaxed min-h-[56px] max-h-[200px] overflow-y-auto"
        />
        <div className="flex items-center justify-between px-3 pb-3 pt-1">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy || !!sessionId}
            className="w-8 h-8 rounded-full border border-[#d8d0ee] flex items-center justify-center
              text-[#9d8ec7] hover:text-[#6c47d9] hover:border-[#8b5cf6] hover:bg-[#f0ebff]
              disabled:opacity-40 transition-all duration-150"
            title={sessionId ? "PDF already uploaded" : "Upload PDF"}
          >
            {isUploading ? <Loader2 size={15} className="animate-spin" /> : <Plus size={16} />}
          </button>
          <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileChange} />
          <div className="flex items-center gap-2">
            <button
              className="w-8 h-8 flex items-center justify-center rounded-full text-[#8b5cf6] hover:bg-[#f0ebff] transition-colors duration-150"
              title="Voice input"
            >
              <Mic size={17} />
            </button>
            <button
              onClick={handleSend}
              disabled={!input.trim() || isBusy}
              className={`w-8 h-8 flex items-center justify-center rounded-full transition-all duration-150
                ${input.trim() && !isBusy
                  ? "bg-gradient-to-br from-[#6c47d9] to-[#8b5cf6] text-white shadow-sm hover:opacity-90"
                  : "text-[#c4b8e8] hover:bg-[#f8f5ff]"
                }`}
              title="Send"
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </div>
      <p className="text-center text-[11px] text-[#b0a4d4] mt-3 leading-relaxed">
        ThinkFill is powered by AI and can make mistakes. Please review the responses.
      </p>
    </div>
  );

  return (
    <div
      className="flex-1 flex flex-col h-full bg-white overflow-hidden relative"
      onDragOver={(e) => {
        e.preventDefault();
        if (!sessionId && !isBusy) setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-20 bg-[#f0ebff]/90 border-4 border-dashed border-[#8b5cf6] rounded-2xl m-3 flex flex-col items-center justify-center pointer-events-none">
          <FileText size={40} className="text-[#6c47d9] mb-3" />
          <p className="text-[#2d1b69] font-semibold">Drop your PDF to get started</p>
        </div>
      )}

      {/* ── WELCOME STATE ── */}
      {!hasConversation && (
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#6c47d9] to-[#8b5cf6] flex items-center justify-center shadow-lg mb-5 select-none">
            <Sparkles size={26} className="text-white" />
          </div>
          <h1 className="text-3xl font-semibold mb-2 text-center select-none">
            <span className="text-[#4b3a8a]">{greeting}, </span>
            <span className="bg-gradient-to-r from-[#e05c8a] to-[#c04880] bg-clip-text text-transparent">
              Gopinath
            </span>
          </h1>
          <p className="text-[#9d8ec7] text-base font-normal mb-8 select-none">
            Upload a PDF or describe what you need to fill out.
          </p>
          <div className="w-full">{inputBox}</div>
        </div>
      )}

      {/* ── CONVERSATION STATE ── */}
      {hasConversation && (
        <>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* File badge at top of conversation */}
            {uploadedFile && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#f0ebff] border border-[#d4c6f5] w-fit sticky top-0 z-10">
                {isUploading ? (
                  <Loader2 size={13} className="text-[#6c47d9] animate-spin" />
                ) : (
                  <FileText size={13} className="text-[#6c47d9]" />
                )}
                <span className="text-[11px] font-medium text-[#6c47d9] max-w-[200px] truncate">
                  {uploadedFile.name}
                </span>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "assistant" && (
                  <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-[#6c47d9] to-[#8b5cf6] flex items-center justify-center flex-shrink-0 mr-2 mt-0.5">
                    <Sparkles size={13} className="text-white" />
                  </div>
                )}
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap
                    ${msg.role === "user"
                      ? "bg-gradient-to-br from-[#6c47d9] to-[#8b5cf6] text-white rounded-tr-sm"
                      : "bg-[#f0ebff] text-[#2d1b69] rounded-tl-sm"
                    }`}
                >
                  {/* Simple bold-markdown renderer */}
                  {msg.text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
                    part.startsWith("**") && part.endsWith("**") ? (
                      <strong key={i}>{part.slice(2, -2)}</strong>
                    ) : (
                      <span key={i}>{part}</span>
                    )
                  )}
                </div>
              </div>
            ))}

            {/* Thinking indicator */}
            {isThinking && (
              <div className="flex justify-start">
                <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-[#6c47d9] to-[#8b5cf6] flex items-center justify-center flex-shrink-0 mr-2 mt-0.5">
                  <Sparkles size={13} className="text-white" />
                </div>
                <div className="bg-[#f0ebff] rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                  <Loader2 size={14} className="text-[#6c47d9] animate-spin" />
                  <span className="text-xs text-[#9d8ec7]">
                    {isUploading ? "Analysing your form…" : "Thinking…"}
                  </span>
                </div>
              </div>
            )}

            {/* "Open Workspace" CTA — shown once a form session exists */}
            {sessionId && !isBusy && (
              <div className="flex justify-start">
                <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-[#6c47d9] to-[#8b5cf6] flex items-center justify-center flex-shrink-0 mr-2 mt-0.5">
                  <Sparkles size={13} className="text-white" />
                </div>
                <div className="bg-[#f0ebff] border border-[#d4c6f5] rounded-2xl rounded-tl-sm px-4 py-3">
                  <p className="text-sm text-[#2d1b69] mb-3 font-medium">
                    Keep answering here, or open the workspace to see the form fill in live.
                  </p>
                  <button
                    onClick={() => goToWorkspace()}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-[#6c47d9] to-[#8b5cf6] text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-sm"
                  >
                    Open Workspace
                    <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-[#e8e4f4] px-4 pb-4 pt-3">
            {inputBox}
          </div>
        </>
      )}
    </div>
  );
}
