"use client";

import { useState, useRef, useEffect } from "react";
import {
  Mic,
  ArrowUp,
  Plus,
  Sparkles,
  FileText,
  X,
  ArrowRight,
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

export default function ChatInterface() {
  const [input, setInput] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isReady, setIsReady] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const greeting = getGreeting();
  const hasConversation = messages.length > 0;

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
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      text: input.trim(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    // Simulate assistant response
    setTimeout(() => {
      const count = messages.length + 1;
      let responseText =
        "I've noted that. Could you tell me more about the specific requirements for this form?";
      if (count >= 3) {
        responseText =
          "I have enough context about your form. You can now open the workspace to start filling it out with my assistance.";
        setIsReady(true);
      }
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          text: responseText,
        },
      ]);
    }, 800);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === "application/pdf") {
      setUploadedFile(file);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          text: `I've received your PDF "${file.name}". Please tell me what you need help with regarding this form — I'll guide you through filling it out.`,
        },
      ]);
    }
  };

  const removeFile = () => {
    setUploadedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const goToWorkspace = () => {
    router.push("/workspace");
  };

  // The input box markup — shared between welcome & conversation states
  const inputBox = (
    <div className="w-full max-w-2xl mx-auto">
      {/* File badge above input */}
      {uploadedFile && !hasConversation && (
        <div className="mb-3 flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-[#f0ebff] border border-[#d4c6f5]">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#6c47d9] to-[#8b5cf6] flex items-center justify-center flex-shrink-0">
            <FileText size={14} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#2d1b69] truncate">{uploadedFile.name}</p>
            <p className="text-[10px] text-[#9d8ec7]">{(uploadedFile.size / 1024).toFixed(1)} KB · PDF</p>
          </div>
          <button
            onClick={removeFile}
            className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-[#e0d5f7] text-[#9d8ec7] hover:text-[#6c47d9] transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      )}

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
          placeholder={uploadedFile ? "Describe what you need help with in this form..." : "Ask your question here"}
          rows={1}
          className="w-full resize-none bg-transparent px-4 pt-4 pb-2 text-[#2d1b69] placeholder-[#c4b8e8] text-sm outline-none leading-relaxed min-h-[56px] max-h-[200px] overflow-y-auto"
        />
        <div className="flex items-center justify-between px-3 pb-3 pt-1">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-8 h-8 rounded-full border border-[#d8d0ee] flex items-center justify-center
              text-[#9d8ec7] hover:text-[#6c47d9] hover:border-[#8b5cf6] hover:bg-[#f0ebff]
              transition-all duration-150"
            title="Upload PDF"
          >
            <Plus size={16} />
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
              disabled={!input.trim()}
              className={`w-8 h-8 flex items-center justify-center rounded-full transition-all duration-150
                ${input.trim()
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
    <div className="flex-1 flex flex-col h-full bg-white overflow-hidden">
      {/* ── WELCOME STATE: everything centered together ── */}
      {!hasConversation && (
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          {/* Logo */}
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#6c47d9] to-[#8b5cf6] flex items-center justify-center shadow-lg mb-5 select-none">
            <Sparkles size={26} className="text-white" />
          </div>
          {/* Greeting */}
          <h1 className="text-3xl font-semibold mb-2 text-center select-none">
            <span className="text-[#4b3a8a]">{greeting}, </span>
            <span className="bg-gradient-to-r from-[#e05c8a] to-[#c04880] bg-clip-text text-transparent">
              Gopinath
            </span>
          </h1>
          <p className="text-[#9d8ec7] text-base font-normal mb-8 select-none">
            Upload a PDF or describe what you need to fill out.
          </p>
          {/* Input box inline in the center */}
          <div className="w-full">{inputBox}</div>
        </div>
      )}

      {/* ── CONVERSATION STATE ── */}
      {hasConversation && (
        <>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* File badge at top */}
            {uploadedFile && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#f0ebff] border border-[#d4c6f5] w-fit">
                <FileText size={13} className="text-[#6c47d9]" />
                <span className="text-[11px] font-medium text-[#6c47d9] max-w-[200px] truncate">
                  {uploadedFile.name}
                </span>
                <button onClick={removeFile}>
                  <X size={11} className="text-[#9d8ec7] hover:text-[#6c47d9]" />
                </button>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-[#6c47d9] to-[#8b5cf6] flex items-center justify-center flex-shrink-0 mr-2 mt-0.5">
                    <Sparkles size={13} className="text-white" />
                  </div>
                )}
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed
                    ${msg.role === "user"
                      ? "bg-gradient-to-br from-[#6c47d9] to-[#8b5cf6] text-white rounded-tr-sm"
                      : "bg-[#f0ebff] text-[#2d1b69] rounded-tl-sm"
                    }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}

            {/* "Open Workspace" CTA */}
            {isReady && (
              <div className="flex justify-start">
                <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-[#6c47d9] to-[#8b5cf6] flex items-center justify-center flex-shrink-0 mr-2 mt-0.5">
                  <Sparkles size={13} className="text-white" />
                </div>
                <div className="bg-[#f0ebff] border border-[#d4c6f5] rounded-2xl rounded-tl-sm px-4 py-3">
                  <p className="text-sm text-[#2d1b69] mb-3 font-medium">Ready to fill out your form?</p>
                  <button
                    onClick={goToWorkspace}
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

          {/* Input at bottom during conversation */}
          <div className="border-t border-[#e8e4f4] px-4 pb-4 pt-3">
            {inputBox}
          </div>
        </>
      )}
    </div>
  );
}
