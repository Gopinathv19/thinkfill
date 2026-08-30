"use client";

import { useState } from "react";
import { useFormContext } from "@/context/FormContext";
import {
  CheckCircle,
  AlertCircle,
  Clock,
  Circle,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Eraser,
  Loader2,
} from "lucide-react";
import type { FormField } from "@/lib/types";

function FieldIcon({ status }: { status: FormField["status"] }) {
  switch (status) {
    case "filled":
      return <CheckCircle size={14} className="text-emerald-500 shrink-0" />;
    case "missing":
      return <AlertCircle size={14} className="text-amber-500 shrink-0" />;
    case "needs-review":
      return <Clock size={14} className="text-blue-500 shrink-0" />;
    case "needs-confirmation":
      return <Clock size={14} className="text-violet-500 shrink-0" />;
    default:
      return <Circle size={14} className="text-gray-400 shrink-0" />;
  }
}

function statusLabel(status: FormField["status"]) {
  switch (status) {
    case "filled":         return "Filled";
    case "missing":        return "Missing";
    case "needs-review":   return "Review";
    case "needs-confirmation": return "Confirm";
  }
}

export default function FormNavigator() {
  const {
    sections,
    activeFieldId,
    setActiveField,
    completionPercent,
    formName,
    fields,
    resetSession,
    sessionId,
    refreshFields,
  } = useFormContext();

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Two-step confirm rather than a browser dialog: clearing is not undoable,
  // and the button sits next to one that navigates away.
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const clearAll = async () => {
    if (!sessionId || clearing) return;
    setConfirmingClear(false);
    setClearing(true);
    try {
      const res = await fetch("/api/session/fields", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) throw new Error(`Clear failed (${res.status})`);
      await refreshFields();
    } catch (err) {
      console.error("[FormNavigator] clear all failed", err);
    } finally {
      setClearing(false);
    }
  };

  const toggleSection = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filledCount  = fields.filter((f) => f.status === "filled").length;
  const missingCount = fields.filter((f) => f.status === "missing").length;

  return (
    <div className="w-72 flex flex-col bg-white border-r border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-gray-900 text-sm font-semibold truncate pr-2" title={formName}>
            {formName || "Form Navigator"}
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            {confirmingClear ? (
              <>
                <button
                  onClick={clearAll}
                  className="px-2 py-1 rounded-md bg-red-500 text-white text-[10px] font-semibold hover:bg-red-600 transition-colors"
                  title="Empty every field in this form"
                >
                  Clear all
                </button>
                <button
                  onClick={() => setConfirmingClear(false)}
                  className="px-2 py-1 rounded-md border border-gray-200 text-gray-500 text-[10px] font-medium hover:text-gray-700 transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmingClear(true)}
                disabled={clearing || filledCount === 0}
                title={filledCount === 0 ? "Nothing to clear" : "Clear every field"}
                className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 transition-colors"
              >
                {clearing ? <Loader2 size={13} className="animate-spin" /> : <Eraser size={13} />}
              </button>
            )}
            <button
              onClick={resetSession}
              title="Upload a new form"
              className="p-1.5 rounded-md text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
            >
              <RotateCcw size={13} />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>{filledCount} of {fields.length} filled</span>
            <span className="font-semibold text-violet-600">{completionPercent}%</span>
          </div>
          <div className="h-1.5 bg-violet-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-600 to-violet-400 rounded-full transition-all duration-500"
              style={{ width: `${completionPercent}%` }}
            />
          </div>
        </div>

        {/* Status badges */}
        <div className="flex gap-3 mt-3">
          <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
            <CheckCircle size={11} />
            {filledCount} filled
          </span>
          <span className="flex items-center gap-1 text-[11px] text-amber-600 font-medium">
            <AlertCircle size={11} />
            {missingCount} missing
          </span>
        </div>
      </div>

      {/* Sections + fields */}
      <div className="flex-1 overflow-y-auto py-2">
        {sections.length === 0 && (
          <p className="text-gray-400 text-xs text-center mt-8 px-4 leading-relaxed">
            No fields extracted from this PDF yet.
          </p>
        )}

        {sections.map((section) => {
          const isCollapsed  = collapsed.has(section.id);
          const sectionFilled = section.fields.filter((f) => f.status === "filled").length;

          return (
            <div key={section.id} className="mb-1">
              {/* Section header */}
              <button
                onClick={() => toggleSection(section.id)}
                className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-violet-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-violet-500 uppercase tracking-wider">
                    {section.title}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {sectionFilled}/{section.fields.length}
                  </span>
                </div>
                {isCollapsed ? (
                  <ChevronRight size={12} className="text-gray-400" />
                ) : (
                  <ChevronDown size={12} className="text-gray-400" />
                )}
              </button>

              {/* Fields list */}
              {!isCollapsed && (
                <div className="px-2 pb-1">
                  {section.fields.map((field) => {
                    const isActive = field.id === activeFieldId;
                    return (
                      <button
                        key={field.id}
                        onClick={() => setActiveField(field.id)}
                        className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-all
                          ${isActive
                            ? "bg-violet-50 border border-violet-200"
                            : "hover:bg-gray-50 border border-transparent"
                          }`}
                      >
                        <FieldIcon status={field.status} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium truncate ${isActive ? "text-violet-700" : "text-gray-700"}`}>
                            {field.label}
                          </p>
                          {field.value ? (
                            <p className="text-[10px] text-gray-500 truncate">{field.value}</p>
                          ) : (
                            <p className="text-[10px] text-gray-400">{statusLabel(field.status)}</p>
                          )}
                        </div>
                        {field.source === "memory" && (
                          <span className="text-[9px] text-violet-600 bg-violet-100 px-1.5 py-0.5 rounded-full shrink-0 font-medium">
                            memory
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
