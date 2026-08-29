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
  // Bold **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    }
    // Code blocks
    if (part.includes("```")) {
      return (
        <pre key={i} className="mt-2 p-2 bg-gray-900 rounded text-[10px] text-gray-300 overflow-x-auto whitespace-pre-wrap">
          {part.replace(/```(?:json)?/g, "").trim()}
        </pre>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ─── Single message bubble ────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  const isTool = msg.role === "tool";
  const isAssistant = msg.role === "assistant";

  if (isTool) {
    const toolName = msg.toolName ?? "tool";
    const isMemoryTool = toolName.includes("memory");
    const isFillTool = toolName === "fill_form_field";

    return (
      <div className="flex items-start gap-2 px-3 py-2">
        <div className="mt-0.5 w-5 h-5 rounded-md bg-violet-900/50 flex items-center justify-center shrink-0">
          {isMemoryTool ? (
            <Database size={11} className="text-violet-400" />
          ) : isFillTool ? (
            <CheckCircle size={11} className="text-emerald-400" />
          ) : (
            <Wrench size={11} className="text-blue-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-medium text-violet-400 mb-0.5">
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
        ${isUser ? "bg-gray-700" : "bg-violet-600"}`}>
        {isUser ? (
          <User size={14} className="text-gray-300" />
        ) : (
          <Bot size={14} className="text-white" />
        )}
      </div>

      {/* Bubble */}
      <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed
        ${isUser
          ? "bg-gray-800 text-gray-200 rounded-tr-sm"
          : "bg-[#1e1a2e] text-gray-300 rounded-tl-sm border border-violet-900/30"
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
    <div className="mx-3 mb-3 p-3 rounded-xl bg-violet-950/60 border border-violet-700/50">
      <div className="flex items-start gap-2 mb-3">
        <Database size={15} className="text-violet-400 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-xs font-semibold text-violet-300 mb-1">Save to profile memory?</p>
          <p className="text-[11px] text-gray-400 leading-relaxed">
            Save <span className="text-white font-medium">{pendingApproval.label}</span>:{" "}
            <span className="text-violet-300">&quot;{pendingApproval.value}&quot;</span>{" "}
            to your profile so it can be auto-filled in future forms.
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={approveMemorySave}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors"
        >
          <CheckCircle size={12} />
          Approve & Save
        </button>
        <button
          onClick={rejectMemorySave}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium transition-colors"
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
    <div className="mx-3 mb-2 px-3 py-2 rounded-lg bg-gray-900/80 border border-gray-800 flex items-center gap-2">
      <div className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-gray-500">Active field</p>
        <p className="text-xs text-white font-medium truncate">{field.label}</p>
      </div>
      {field.value ? (
        <span className="text-[10px] text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded-full">
          filled
        </span>
      ) : (
        <span className="text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full">
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

  // Auto-scroll to bottom on new messages
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
    <div className="w-96 flex flex-col bg-[#0f0f11] border-l border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center">
          <Bot size={15} className="text-white" />
        </div>
        <div>
          <p className="text-white text-sm font-semibold leading-none">ThinkFill Assistant</p>
          <p className="text-gray-500 text-[10px] mt-0.5">AI form-filling agent</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${sessionId ? "bg-emerald-400 animate-pulse" : "bg-gray-600"}`} />
          <span className="text-[10px] text-gray-500">{sessionId ? "Active" : "No session"}</span>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto py-3 space-y-0.5">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6">
            <div className="w-12 h-12 rounded-2xl bg-violet-900/30 flex items-center justify-center">
              <Bot size={24} className="text-violet-400" />
            </div>
            <p className="text-gray-500 text-xs text-center leading-relaxed">
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
            <div className="bg-[#1e1a2e] border border-violet-900/30 rounded-2xl rounded-tl-sm px-3.5 py-2.5 flex items-center gap-2">
              <Loader2 size={13} className="text-violet-400 animate-spin" />
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
      <div className="px-3 pb-3">
        <div className="flex items-end gap-2 bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 focus-within:border-violet-600 transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={sessionId ? "Type a message…" : "Upload a PDF to start"}
            disabled={!sessionId || isChatLoading}
            rows={1}
            className="flex-1 bg-transparent text-gray-200 text-sm placeholder:text-gray-600 resize-none outline-none max-h-32 disabled:opacity-40"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isChatLoading || !sessionId}
            className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center text-white transition-all hover:bg-violet-500 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          >
            <Send size={14} />
          </button>
        </div>
        <p className="text-[10px] text-gray-700 mt-1.5 text-center">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
