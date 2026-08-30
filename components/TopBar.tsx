"use client";

import { FileText, Sparkles, Upload } from "lucide-react";
import { usePathname } from "next/navigation";
import { useOptionalFormContext } from "@/context/FormContext";

function WorkspaceTopBar({ ctx }: { ctx: NonNullable<ReturnType<typeof useOptionalFormContext>> }) {
  const { formName, completionPercent, sessionId, resetSession } = ctx;

  return (
    <header className="h-14 flex items-center justify-between px-5 border-b border-violet-100 bg-white shrink-0 shadow-sm">
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-violet-600 flex items-center justify-center shadow-md shadow-violet-200">
          <FileText size={15} className="text-white" />
        </div>
        <span className="text-gray-900 text-sm font-bold tracking-tight">ThinkFill</span>
        {sessionId && formName && (
          <>
            <span className="text-gray-300 text-sm">/</span>
            <span className="text-gray-500 text-sm truncate max-w-48">{formName}</span>
          </>
        )}
      </div>

      {/* Centre — progress */}
      {sessionId && (
        <div className="flex items-center gap-3">
          <div className="w-44 h-1.5 bg-violet-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-600 to-violet-400 rounded-full transition-all duration-500"
              style={{ width: `${completionPercent}%` }}
            />
          </div>
          <span className="text-xs text-violet-600 font-semibold w-8">{completionPercent}%</span>
        </div>
      )}

      {/* Right — actions */}
      <div className="flex items-center gap-2">
        {sessionId && (
          <button
            onClick={resetSession}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-gray-500 hover:text-violet-600 hover:bg-violet-50 text-xs font-medium transition-colors"
          >
            <Upload size={13} />
            New Form
          </button>
        )}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 shadow-sm shadow-violet-200">
          <Sparkles size={12} className="text-white" />
          <span className="text-white text-xs font-semibold">TrueForge Agent</span>
        </div>
      </div>
    </header>
  );
}

function StaticTopBar() {
  return (
    <header className="h-14 flex items-center justify-between px-5 border-b border-violet-100 bg-white shrink-0 shadow-sm">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-violet-600 flex items-center justify-center shadow-md shadow-violet-200">
          <FileText size={15} className="text-white" />
        </div>
        <span className="text-gray-900 text-sm font-bold tracking-tight">ThinkFill</span>
      </div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 shadow-sm shadow-violet-200">
        <Sparkles size={12} className="text-white" />
        <span className="text-white text-xs font-semibold">TrueForge Agent</span>
      </div>
    </header>
  );
}

export default function TopBar() {
  const pathname = usePathname();
  // The bar renders on pages with and without a form session, so the context is
  // read optionally rather than through the throwing hook. Reading it here
  // (not conditionally inside a branch) keeps the hook order stable.
  const ctx = useOptionalFormContext();

  if (pathname?.startsWith("/workspace") && ctx) {
    return <WorkspaceTopBar ctx={ctx} />;
  }
  return <StaticTopBar />;
}
