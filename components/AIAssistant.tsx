"use client";

import { useRef, useEffect, useState } from "react";
import { useFormContext } from "@/context/FormContext";
import {
  Send,
  Bot,
  User,
  Wrench,
  CheckCircle,
  XCircle,
  Database,
  Loader2,
} from "lucide-react";
import type { ChatMessage } from "@/lib/types";

// ─── Simple markdown-like renderer ───────────────────────────────────────────
function renderContent(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>;
    }
    if (part.includes("```")) {
      return (
        <pre key={i} className="mt-2 p-2 bg-violet-50 border border-violet-100 rounded-lg text-[10px] text-violet-700 overflow-x-auto whitespace-pre-wrap">
          {part.replace(/```(?:json)?/g, "").trim()}
        </pre>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ─── Single message bubble ────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser      = msg.role === "user";
  const isTool      = msg.role === "tool";
  const isAssistant = msg.role === "assistant";

  if (isTool) {
    const toolName    = msg.toolName ?? "tool";
    const isMemoryTool = toolName.includes("memory");
    const isFillTool   = toolName === "fill_form_field";

    return (
      <div className="flex items-start gap-2 px-3 py-2">
        <div className="mt-0.5 w-5 h-5 rounded-md bg-violet-100 flex items-center justify-center shrink-0">
          {isMemoryTool ? (
            <Database size={11} className="text-violet-600" />
          ) : isFillTool ? (
            <CheckCircle size={11} className="text-emerald-600" />
          ) : (
            <Wrench size={11} className="text-blue-600" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold text-violet-600 mb-0.5">
            ⚡ {toolName.replace(/_/g, " ")}
          </p>
          <div className="text-[10px] text-gray-500 leading-relaxed">
            {renderContent(msg.content.replace(/^Tool: \*\*[^*]+\*\*\n/, ""))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-2.5 px-3 py-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5
        ${isUser ? "bg-gray-200" : "bg-violet-600"}`}>
        {isUser ? (
          <User size={14} className="text-gray-600" />
        ) : (
          <Bot size={14} className="text-white" />
        )}
      </div>

      {/* Bubble */}
      <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed
        ${isUser
          ? "bg-violet-600 text-white rounded-tr-sm"
          : "bg-gray-50 text-gray-700 rounded-tl-sm border border-gray-200"
        }`}>
        {isAssistant ? renderContent(msg.content) : msg.content}
      </div>
    </div>
  );
}

// ─── Approval card ────────────────────────────────────────────────────────────
function ApprovalCard() {
  const { pendingApproval, approveMemorySave, rejectMemorySave } = useFormContext();
  if (!pendingApproval) return null;

  return (
    <div className="mx-3 mb-3 p-3 rounded-xl bg-violet-50 border border-violet-200">
      <div className="flex items-start gap-2 mb-3">
        <Database size={15} className="text-violet-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-xs font-semibold text-violet-700 mb-1">Save to profile memory?</p>
          <p className="text-[11px] text-gray-600 leading-relaxed">
            Save <span className="text-gray-900 font-medium">{pendingApproval.label}</span>:{" "}
            <span className="text-violet-600">&quot;{pendingApproval.value}&quot;</span>{" "}
            to your profile so it can be auto-filled in future forms.
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={approveMemorySave}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-colors"
        >
          <CheckCircle size={12} />
          Approve &amp; Save
        </button>
        <button
          onClick={rejectMemorySave}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-white hover:bg-gray-100 text-gray-600 text-xs font-medium border border-gray-200 transition-colors"
        >
          <XCircle size={12} />
          Don&apos;t Save
        </button>
      </div>
    </div>
  );
}

// ─── Active field context banner ──────────────────────────────────────────────
function ActiveFieldBanner() {
  const { activeFieldId, fields } = useFormContext();
  if (!activeFieldId) return null;
  const field = fields.find((f) => f.id === activeFieldId);
  if (!field) return null;

  return (
    <div className="mx-3 mb-2 px-3 py-2 rounded-lg bg-violet-50 border border-violet-200 flex items-center gap-2">
      <div className="w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-gray-500">Active field</p>
        <p className="text-xs text-gray-900 font-medium truncate">{field.label}</p>
      </div>
      {field.value ? (
        <span className="text-[10px] text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full font-medium">
          filled
        </span>
      ) : (
        <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full font-medium">
          empty
        </span>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AIAssistant() {
  const { messages, isChatLoading, sendMessage, sessionId } = useFormContext();

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isChatLoading]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isChatLoading || !sessionId) return;
    setInput("");
    sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="w-96 flex flex-col bg-white border-l border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 bg-white">
        <div className="w-8 h-8 rounded-xl bg-violet-600 flex items-center justify-center shadow-sm shadow-violet-200">
          <Bot size={15} className="text-white" />
        </div>
        <div>
          <p className="text-gray-900 text-sm font-semibold leading-none">ThinkFill Assistant</p>
          <p className="text-gray-400 text-[10px] mt-0.5">AI form-filling agent</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${sessionId ? "bg-emerald-500 animate-pulse" : "bg-gray-300"}`} />
          <span className="text-[10px] text-gray-400">{sessionId ? "Active" : "No session"}</span>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto py-3 space-y-0.5 bg-white">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6">
            <div className="w-12 h-12 rounded-2xl bg-violet-100 flex items-center justify-center">
              <Bot size={24} className="text-violet-600" />
            </div>
            <p className="text-gray-400 text-xs text-center leading-relaxed">
              Upload a PDF form to start. The AI agent will help you fill it using your saved profile.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {/* Typing indicator */}
        {isChatLoading && (
          <div className="flex gap-2.5 px-3 py-2">
            <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center shrink-0">
              <Bot size={14} className="text-white" />
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-2xl rounded-tl-sm px-3.5 py-2.5 flex items-center gap-2">
              <Loader2 size={13} className="text-violet-500 animate-spin" />
              <span className="text-[12px] text-gray-500">Agent is thinking…</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Active field context */}
      <ActiveFieldBanner />

      {/* Memory approval card */}
      <ApprovalCard />

      {/* Input area */}
      <div className="px-3 pb-3 bg-white border-t border-gray-100 pt-3">
        <div className="flex items-end gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 focus-within:border-violet-400 focus-within:bg-white transition-colors shadow-sm">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={sessionId ? "Type a message…" : "Upload a PDF to start"}
            disabled={!sessionId || isChatLoading}
            rows={1}
            className="flex-1 bg-transparent text-gray-700 text-sm placeholder:text-gray-400 resize-none outline-none max-h-32 disabled:opacity-40"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isChatLoading || !sessionId}
            className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center text-white transition-all hover:bg-violet-700 disabled:opacity-30 disabled:cursor-not-allowed shrink-0 shadow-sm"
          >
            <Send size={14} />
          </button>
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5 text-center">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
