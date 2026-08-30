"use client";

import { useState, useEffect } from "react";
import {
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  Trash2,
  Loader2,
  FileText,
} from "lucide-react";
import { useRouter } from "next/navigation";

interface SessionItem {
  id: string;
  formName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  totalFields: number;
  filledFields: number;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return `Today, ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

interface ChatSidebarProps {
  activeId?: string;
  onSelect?: (id: string) => void;
}

export default function ChatSidebar({ activeId, onSelect }: ChatSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoadingSessions(true);
      try {
        const res = await fetch("/api/sessions");
        const data = await res.json();
        if (!cancelled && data.sessions) setSessions(data.sessions);
      } catch {
        // silent
      } finally {
        if (!cancelled) setIsLoadingSessions(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const handleNewChat = () => {
    router.push("/chat");
  };

  const handleSessionClick = (id: string) => {
    onSelect?.(id);
    router.push(`/workspace?session=${id}`);
  };

  /**
   * Delete a session, its stored PDF and its agent session.
   *
   * Two clicks rather than a `confirm()` dialog: the first arms the row, the
   * second commits. This is irreversible and the list is dense, so an
   * accidental click must not destroy someone's form.
   */
  const handleDelete = async (id: string) => {
    if (confirmingId !== id) {
      setConfirmingId(id);
      return;
    }

    setConfirmingId(null);
    setDeletingId(id);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);

      setSessions((prev) => prev.filter((s) => s.id !== id));

      // Leave the workspace if it is showing the session that just went away.
      // Read the URL here rather than with useSearchParams: that hook opts the
      // whole sidebar — and so every page rendering it — out of static
      // prerendering, and this only needs to be known at click time.
      const current = new URLSearchParams(window.location.search).get("session");
      if (window.location.pathname.startsWith("/workspace") && current === id) {
        router.push("/chat");
      }
    } catch (err) {
      console.error("[ChatSidebar] delete failed", err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <aside
      className={`relative flex flex-col h-full transition-all duration-300 ease-in-out
        ${collapsed ? "w-16" : "w-72"}
        bg-white border-r border-[#e8e4f4]`}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-[#e8e4f4]">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#6c47d9] to-[#8b5cf6] flex items-center justify-center shadow-sm">
              <MessageSquare size={15} className="text-white" />
            </div>
            <span className="font-semibold text-[#2d1b69] text-sm tracking-wide">
              Workspaces
            </span>
          </div>
        )}
        {collapsed && (
          <div className="mx-auto w-8 h-8 rounded-xl bg-gradient-to-br from-[#6c47d9] to-[#8b5cf6] flex items-center justify-center shadow-sm">
            <MessageSquare size={15} className="text-white" />
          </div>
        )}
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="text-[#9d8ec7] hover:text-[#6c47d9] transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
        )}
      </div>

      {/* Expand button when collapsed */}
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="mx-auto mt-3 text-[#9d8ec7] hover:text-[#6c47d9] transition-colors"
        >
          <ChevronRight size={18} />
        </button>
      )}

      {/* New Chat button */}
      {!collapsed && (
        <div className="px-3 pt-3 pb-1">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl
              bg-gradient-to-r from-[#6c47d9] to-[#8b5cf6] text-white text-sm font-medium
              hover:opacity-90 transition-opacity shadow-sm"
          >
            <Plus size={16} />
            New Chat
          </button>
        </div>
      )}

      {/* History section */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 scrollbar-thin">
          <div className="flex items-center gap-1.5 px-2 py-1.5 mb-1">
            <Clock size={13} className="text-[#9d8ec7]" />
            <span className="text-[11px] font-semibold text-[#9d8ec7] uppercase tracking-widest">
              Recent Sessions
            </span>
          </div>

          {isLoadingSessions && (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={18} className="text-[#9d8ec7] animate-spin" />
            </div>
          )}

          {!isLoadingSessions && sessions.length === 0 && (
            <div className="flex flex-col items-center py-6 gap-2 text-center">
              <FileText size={20} className="text-[#c4b8e8]" />
              <p className="text-xs text-[#9d8ec7]">No sessions yet.<br />Upload a PDF to get started.</p>
            </div>
          )}

          {sessions.map((item) => {
            const pct = item.totalFields > 0
              ? Math.round((item.filledFields / item.totalFields) * 100)
              : 0;
            return (
              <div
                key={item.id}
                className={`group relative flex items-start gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150
                  ${activeId === item.id
                    ? "bg-[#f0ebff] border border-[#d4c6f5]"
                    : "hover:bg-[#f8f5ff] border border-transparent"
                  }`}
                onMouseEnter={() => setHoveredId(item.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => handleSessionClick(item.id)}
              >
                <div
                  className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0
                  ${activeId === item.id
                    ? "bg-gradient-to-br from-[#6c47d9] to-[#8b5cf6]"
                    : "bg-[#ede9f7]"
                  }`}
                >
                  <FileText
                    size={12}
                    className={activeId === item.id ? "text-white" : "text-[#9d8ec7]"}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium truncate ${
                      activeId === item.id ? "text-[#6c47d9]" : "text-[#2d1b69]"
                    }`}
                  >
                    {item.formName}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    {/* Mini progress bar */}
                    <div className="flex-1 h-1 rounded-full bg-[#ede9f7] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#6c47d9] to-[#8b5cf6] transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-[#9d8ec7] flex-shrink-0">{pct}%</span>
                  </div>
                  <p className="text-[10px] text-[#c4b8e8] mt-0.5">
                    {formatTimestamp(item.updatedAt)}
                  </p>
                </div>

                {/* Hover actions */}
                {(hoveredId === item.id || confirmingId === item.id || deletingId === item.id) && (
                  <div className="flex items-center gap-1 absolute right-2 top-2.5">
                    {deletingId === item.id ? (
                      <Loader2 size={13} className="text-[#9d8ec7] animate-spin" />
                    ) : confirmingId === item.id ? (
                      <>
                        <button
                          className="px-2 py-0.5 rounded-lg bg-[#e05c8a] text-white text-[10px] font-semibold hover:opacity-90 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(item.id);
                          }}
                          title="Permanently delete this session and its PDF"
                        >
                          Delete
                        </button>
                        <button
                          className="px-2 py-0.5 rounded-lg bg-white border border-[#d8d0ee] text-[#9d8ec7] text-[10px] font-medium hover:text-[#6c47d9] transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmingId(null);
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="p-1 rounded-lg hover:bg-[#ffe4e8] text-[#9d8ec7] hover:text-[#e05c8a] transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(item.id);
                        }}
                        title="Delete session"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Collapsed icons */}
      {collapsed && (
        <div className="flex-1 flex flex-col items-center gap-2 pt-2 px-2">
          {sessions.slice(0, 7).map((item) => (
            <button
              key={item.id}
              title={item.formName}
              onClick={() => handleSessionClick(item.id)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all
                ${activeId === item.id
                  ? "bg-gradient-to-br from-[#6c47d9] to-[#8b5cf6] shadow-sm"
                  : "bg-[#ede9f7] hover:bg-[#e0d8f5]"
                }`}
            >
              <FileText
                size={14}
                className={activeId === item.id ? "text-white" : "text-[#9d8ec7]"}
              />
            </button>
          ))}
        </div>
      )}

      {/* Bottom user area */}
      {!collapsed && (
        <div className="px-3 py-3 border-t border-[#e8e4f4]">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-[#f8f5ff] cursor-pointer transition-colors">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#e05c8a] to-[#8b5cf6] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              G
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#2d1b69] truncate">
                Gopinath
              </p>
              <p className="text-[10px] text-[#9d8ec7]">Free Plan</p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
