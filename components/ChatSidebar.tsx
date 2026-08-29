"use client";

import { useState } from "react";
import {
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  Trash2,
  MoreHorizontal,
} from "lucide-react";

interface WorkspaceItem {
  id: string;
  title: string;
  timestamp: string;
  preview: string;
}

const historyData: WorkspaceItem[] = [
  {
    id: "1",
    title: "Customer Support Analysis",
    timestamp: "Today, 8:30 PM",
    preview: "List all open tickets for Q3...",
  },
  {
    id: "2",
    title: "SLA Violation Report",
    timestamp: "Today, 6:15 PM",
    preview: "Show all SLA violated tickets...",
  },
  {
    id: "3",
    title: "Team Performance Review",
    timestamp: "Yesterday",
    preview: "Summarize agent performance...",
  },
  {
    id: "4",
    title: "Ticket Escalation Check",
    timestamp: "Yesterday",
    preview: "Find escalated tickets this week...",
  },
  {
    id: "5",
    title: "Monthly Summary",
    timestamp: "Aug 27",
    preview: "Generate monthly report for...",
  },
  {
    id: "6",
    title: "Priority Tickets Review",
    timestamp: "Aug 25",
    preview: "List all high-priority tickets...",
  },
  {
    id: "7",
    title: "Unresolved Queries",
    timestamp: "Aug 24",
    preview: "Show unresolved queries older than...",
  },
];

interface ChatSidebarProps {
  activeId?: string;
  onSelect?: (id: string) => void;
}

export default function ChatSidebar({ activeId, onSelect }: ChatSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

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
              Recent History
            </span>
          </div>

          {historyData.map((item) => (
            <div
              key={item.id}
              className={`group relative flex items-start gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150
                ${
                  activeId === item.id
                    ? "bg-[#f0ebff] border border-[#d4c6f5]"
                    : "hover:bg-[#f8f5ff] border border-transparent"
                }`}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onSelect?.(item.id)}
            >
              <div
                className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0
                ${
                  activeId === item.id
                    ? "bg-gradient-to-br from-[#6c47d9] to-[#8b5cf6]"
                    : "bg-[#ede9f7]"
                }`}
              >
                <MessageSquare
                  size={12}
                  className={
                    activeId === item.id ? "text-white" : "text-[#9d8ec7]"
                  }
                />
              </div>

              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm font-medium truncate ${
                    activeId === item.id ? "text-[#6c47d9]" : "text-[#2d1b69]"
                  }`}
                >
                  {item.title}
                </p>
                <p className="text-[11px] text-[#9d8ec7] truncate mt-0.5">
                  {item.preview}
                </p>
                <p className="text-[10px] text-[#c4b8e8] mt-0.5">
                  {item.timestamp}
                </p>
              </div>

              {/* Hover actions */}
              {hoveredId === item.id && (
                <div className="flex items-center gap-1 absolute right-2 top-2.5">
                  <button
                    className="p-1 rounded-lg hover:bg-[#e8e0f5] text-[#9d8ec7] hover:text-[#6c47d9] transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal size={13} />
                  </button>
                  <button
                    className="p-1 rounded-lg hover:bg-[#ffe4e8] text-[#9d8ec7] hover:text-[#e05c8a] transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Collapsed icons */}
      {collapsed && (
        <div className="flex-1 flex flex-col items-center gap-2 pt-2 px-2">
          {historyData.slice(0, 7).map((item) => (
            <button
              key={item.id}
              title={item.title}
              onClick={() => onSelect?.(item.id)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all
                ${
                  activeId === item.id
                    ? "bg-gradient-to-br from-[#6c47d9] to-[#8b5cf6] shadow-sm"
                    : "bg-[#ede9f7] hover:bg-[#e0d8f5]"
                }`}
            >
              <MessageSquare
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
