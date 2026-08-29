"use client";

import { FileText, Sparkles, Upload } from "lucide-react";
import { usePathname } from "next/navigation";

// TopBar is used in the workspace layout which wraps FormProvider.
// We conditionally import context only when inside the workspace.
function WorkspaceTopBar() {
  // Dynamic import pattern — only rendered inside workspace where context is available
  const { useFormContext } = require("@/context/FormContext");
  const { formName, completionPercent, sessionId, resetSession } = useFormContext();

  return (
    <header className="h-12 flex items-center justify-between px-4 border-b border-gray-800 bg-[#0f0f11] shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center">
          <FileText size={14} className="text-white" />
        </div>
        <span className="text-white text-sm font-bold tracking-tight">ThinkFill</span>
        {sessionId && formName && (
          <>
            <span className="text-gray-700 text-sm">/</span>
            <span className="text-gray-400 text-sm truncate max-w-48">{formName}</span>
          </>
        )}
      </div>

      {/* Centre — progress */}
      {sessionId && (
        <div className="flex items-center gap-3">
          <div className="w-40 h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-600 to-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${completionPercent}%` }}
            />
          </div>
          <span className="text-xs text-gray-400 font-medium w-8">{completionPercent}%</span>
        </div>
      )}

      {/* Right — actions */}
      <div className="flex items-center gap-2">
        {sessionId && (
          <button
            onClick={resetSession}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 text-xs transition-colors"
          >
            <Upload size={13} />
            New Form
          </button>
        )}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-900/30 border border-violet-800/40">
          <Sparkles size={12} className="text-violet-400" />
          <span className="text-violet-300 text-xs font-medium">TrueForge Agent</span>
        </div>
      </div>
    </header>
  );
}

function StaticTopBar() {
  return (
    <header className="h-12 flex items-center justify-between px-4 border-b border-gray-800 bg-[#0f0f11] shrink-0">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center">
          <FileText size={14} className="text-white" />
        </div>
        <span className="text-white text-sm font-bold tracking-tight">ThinkFill</span>
      </div>
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-900/30 border border-violet-800/40">
        <Sparkles size={12} className="text-violet-400" />
        <span className="text-violet-300 text-xs font-medium">TrueForge Agent</span>
      </div>
    </header>
  );
}

export default function TopBar() {
  const pathname = usePathname();
  const isWorkspace = pathname?.startsWith("/workspace");

  if (isWorkspace) {
    return <WorkspaceTopBar />;
  }
  return <StaticTopBar />;
}
