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
} from "lucide-react";
import type { FormField } from "@/lib/types";

function FieldIcon({ status }: { status: FormField["status"] }) {
  switch (status) {
    case "filled":
      return <CheckCircle size={14} className="text-emerald-400 shrink-0" />;
    case "missing":
      return <AlertCircle size={14} className="text-amber-400 shrink-0" />;
    case "needs-review":
      return <Clock size={14} className="text-blue-400 shrink-0" />;
    case "needs-confirmation":
      return <Clock size={14} className="text-violet-400 shrink-0" />;
    default:
      return <Circle size={14} className="text-gray-500 shrink-0" />;
  }
}

function statusLabel(status: FormField["status"]) {
  switch (status) {
    case "filled":
      return "Filled";
    case "missing":
      return "Missing";
    case "needs-review":
      return "Review";
    case "needs-confirmation":
      return "Confirm";
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
  } = useFormContext();

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleSection = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filledCount = fields.filter((f) => f.status === "filled").length;
  const missingCount = fields.filter((f) => f.status === "missing").length;

  return (
    <div className="w-72 flex flex-col bg-[#0f0f11] border-r border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white text-sm font-semibold truncate pr-2" title={formName}>
            {formName || "Form Navigator"}
          </h2>
          <button
            onClick={resetSession}
            title="Upload a new form"
            className="p-1.5 rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
          >
            <RotateCcw size={13} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>{filledCount} of {fields.length} filled</span>
            <span className="font-medium text-gray-400">{completionPercent}%</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-600 to-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${completionPercent}%` }}
            />
          </div>
        </div>

        {/* Status badges */}
        <div className="flex gap-2 mt-3">
          <span className="flex items-center gap-1 text-[11px] text-emerald-400">
            <CheckCircle size={11} />
            {filledCount} filled
          </span>
          <span className="flex items-center gap-1 text-[11px] text-amber-400">
            <AlertCircle size={11} />
            {missingCount} missing
          </span>
        </div>
      </div>

      {/* Sections + fields */}
      <div className="flex-1 overflow-y-auto py-2">
        {sections.length === 0 && (
          <p className="text-gray-600 text-xs text-center mt-8 px-4">
            No fields extracted from this PDF yet.
          </p>
        )}

        {sections.map((section) => {
          const isCollapsed = collapsed.has(section.id);
          const sectionFilled = section.fields.filter((f) => f.status === "filled").length;

          return (
            <div key={section.id} className="mb-1">
              {/* Section header */}
              <button
                onClick={() => toggleSection(section.id)}
                className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-gray-900 transition-colors group"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                    {section.title}
                  </span>
                  <span className="text-[10px] text-gray-600">
                    {sectionFilled}/{section.fields.length}
                  </span>
                </div>
                {isCollapsed ? (
                  <ChevronRight size={12} className="text-gray-600" />
                ) : (
                  <ChevronDown size={12} className="text-gray-600" />
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
                            ? "bg-violet-600/20 border border-violet-500/40"
                            : "hover:bg-gray-900 border border-transparent"
                          }`}
                      >
                        <FieldIcon status={field.status} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium truncate ${isActive ? "text-white" : "text-gray-300"}`}>
                            {field.label}
                          </p>
                          {field.value ? (
                            <p className="text-[10px] text-gray-500 truncate">{field.value}</p>
                          ) : (
                            <p className="text-[10px] text-gray-600">{statusLabel(field.status)}</p>
                          )}
                        </div>
                        {field.source === "memory" && (
                          <span className="text-[9px] text-violet-400 bg-violet-400/10 px-1.5 py-0.5 rounded-full shrink-0">
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
