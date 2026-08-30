"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useFormContext } from "@/context/FormContext";
import {
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Type,
  Download,
} from "lucide-react";

// ─── pdf.js dynamic loader ───────────────────────────────────────────────────
let pdfjsLib: typeof import("pdfjs-dist") | null = null;

async function getPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  const lib = await import("pdfjs-dist");
  lib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${lib.version}/build/pdf.worker.min.mjs`;
  pdfjsLib = lib;
  return lib;
}

// ─── Text style state ────────────────────────────────────────────────────────
interface TextStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: "left" | "center" | "right";
  fontSize: number;
  color: string;
}

const defaultStyle: TextStyle = {
  bold: false,
  italic: false,
  underline: false,
  align: "left",
  fontSize: 12,
  color: "#111827",
};

// ─── Field status colours ────────────────────────────────────────────────────
function borderColor(status: string, isActive: boolean) {
  if (isActive) {
    switch (status) {
      case "filled":   return "border-emerald-400";
      case "missing":  return "border-violet-500";
      default:         return "border-violet-500";
    }
  }
  switch (status) {
    case "filled":   return "border-emerald-400";
    case "missing":  return "border-amber-400";
    default:         return "border-gray-400";
  }
}

// ─── Formatting Toolbar ──────────────────────────────────────────────────────
function FormattingToolbar({
  style,
  onChange,
  onExport,
  sessionId,
}: {
  style: TextStyle;
  onChange: (patch: Partial<TextStyle>) => void;
  onExport: () => void;
  sessionId: string | null;
}) {
  const fontSizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32];

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 bg-white border-b border-gray-200 flex-wrap shadow-sm">
      {/* Font size */}
      <div className="flex items-center gap-1 mr-1">
        <Type size={12} className="text-gray-400" />
        <select
          value={style.fontSize}
          onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
          className="bg-gray-50 border border-gray-200 rounded text-gray-700 text-[11px] px-1 py-0.5 outline-none"
        >
          {fontSizes.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="w-px h-4 bg-gray-200 mx-1" />

      {/* Bold */}
      <button
        onClick={() => onChange({ bold: !style.bold })}
        title="Bold"
        className={`p-1.5 rounded transition-colors ${style.bold ? "bg-violet-600 text-white" : "text-gray-500 hover:text-violet-600 hover:bg-violet-50"}`}
      >
        <Bold size={13} />
      </button>

      {/* Italic */}
      <button
        onClick={() => onChange({ italic: !style.italic })}
        title="Italic"
        className={`p-1.5 rounded transition-colors ${style.italic ? "bg-violet-600 text-white" : "text-gray-500 hover:text-violet-600 hover:bg-violet-50"}`}
      >
        <Italic size={13} />
      </button>

      {/* Underline */}
      <button
        onClick={() => onChange({ underline: !style.underline })}
        title="Underline"
        className={`p-1.5 rounded transition-colors ${style.underline ? "bg-violet-600 text-white" : "text-gray-500 hover:text-violet-600 hover:bg-violet-50"}`}
      >
        <Underline size={13} />
      </button>

      <div className="w-px h-4 bg-gray-200 mx-1" />

      {/* Alignment */}
      {(["left", "center", "right"] as const).map((a) => {
        const Icon = a === "left" ? AlignLeft : a === "center" ? AlignCenter : AlignRight;
        return (
          <button
            key={a}
            onClick={() => onChange({ align: a })}
            title={`Align ${a}`}
            className={`p-1.5 rounded transition-colors ${style.align === a ? "bg-violet-600 text-white" : "text-gray-500 hover:text-violet-600 hover:bg-violet-50"}`}
          >
            <Icon size={13} />
          </button>
        );
      })}

      <div className="w-px h-4 bg-gray-200 mx-1" />

      {/* Text colour */}
      <label title="Text colour" className="relative cursor-pointer">
        <div
          className="w-5 h-5 rounded border border-gray-300"
          style={{ background: style.color }}
        />
        <input
          type="color"
          value={style.color}
          onChange={(e) => onChange({ color: e.target.value })}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
        />
      </label>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Export */}
      <button
        onClick={onExport}
        disabled={!sessionId}
        title="Export filled PDF"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
      >
        <Download size={13} />
        Export PDF
      </button>
    </div>
  );
}

// ─── Inline field input ──────────────────────────────────────────────────────
function InlineFieldInput({
  field,
  style,
  onSave,
  onFocus,
  isActive,
}: {
  field: { id: string; label: string; value: string; type: string; status: string };
  style: TextStyle;
  onSave: (fieldId: string, value: string) => void;
  onFocus: () => void;
  isActive: boolean;
}) {
  const [localVal, setLocalVal] = useState(field.value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep local value in sync when field value changes (e.g. agent fills it)
  useEffect(() => {
    setLocalVal(field.value);
  }, [field.value]);

  const commit = () => {
    if (localVal !== field.value) {
      onSave(field.id, localVal);
    }
  };

  const fontStyle: React.CSSProperties = {
    fontSize: style.fontSize,
    fontWeight: style.bold ? "bold" : "normal",
    fontStyle: style.italic ? "italic" : "normal",
    textDecoration: style.underline ? "underline" : "none",
    textAlign: style.align,
    color: style.color,
  };

  return (
    <div
      className={`absolute border-2 rounded-sm transition-all duration-150 group
        ${borderColor(field.status, isActive)}
        ${isActive ? "bg-white/10 shadow-lg ring-1 ring-violet-400/40" : "bg-transparent hover:bg-white/5"}`}
      style={{ inset: 0 }}
      onClick={onFocus}
    >
      <input
        ref={inputRef}
        value={localVal}
        onChange={(e) => setLocalVal(e.target.value)}
        onFocus={onFocus}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { commit(); inputRef.current?.blur(); }
          if (e.key === "Escape") { setLocalVal(field.value); inputRef.current?.blur(); }
        }}
        placeholder={isActive ? `Enter ${field.label.toLowerCase()}…` : ""}
        className="w-full h-full bg-transparent outline-none border-none px-1.5 placeholder-gray-500/50"
        style={fontStyle}
      />
      {/* Subtle label hint when not active and no value */}
      {!isActive && !localVal && (
        <span
          className="absolute inset-0 flex items-center px-1.5 text-[10px] text-amber-400/60 pointer-events-none select-none"
          style={{ fontSize: Math.max(9, style.fontSize * 0.75) }}
        >
          {field.label}
        </span>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function FormDocument() {
  const { pdfUrl, fields, activeFieldId, setActiveField, totalPages, sessionId, refreshFields } =
    useFormContext();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.2);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [renderKey, setRenderKey] = useState(0);
  const [textStyle, setTextStyle] = useState<TextStyle>(defaultStyle);
  const [exporting, setExporting] = useState(false);

  // ── Render PDF page ──────────────────────────────────────────────────────
  const renderPage = useCallback(async () => {
    if (!pdfUrl || !canvasRef.current) return;

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    try {
      const lib = await getPdfJs();
      const pdf = await lib.getDocument({ url: pdfUrl, disableStream: false }).promise;
      const page = await pdf.getPage(currentPage);

      const viewport = page.getViewport({ scale: zoom });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      setPageSize({ width: viewport.width, height: viewport.height });

      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
      renderTaskRef.current = null;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "RenderingCancelledException") return;
      if (String(err).includes("cancelled")) return;
      console.error("[FormDocument] render error", err);
    }
  }, [pdfUrl, currentPage, zoom]);

  useEffect(() => {
    renderPage();
    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [renderPage, renderKey]);

  // Auto-switch page when active field changes
  useEffect(() => {
    if (!activeFieldId) return;
    const field = fields.find((f) => f.id === activeFieldId);
    if (field && field.page !== currentPage) setCurrentPage(field.page);
  }, [activeFieldId, fields, currentPage]);

  // ── Save a field the user edited directly in the document ────────────────
  const saveField = useCallback(
    async (fieldId: string, value: string) => {
      if (!sessionId) return;
      try {
        await fetch("/api/session/fields", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, fieldId, value }),
        });
        await refreshFields();
      } catch (err) {
        console.error("[FormDocument] saveField error", err);
      }
    },
    [sessionId, refreshFields]
  );

  // ── Export PDF ────────────────────────────────────────────────────────────
  const exportPdf = useCallback(async () => {
    if (!sessionId || !pdfUrl || exporting) return;
    setExporting(true);

    try {
      const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");

      // Fetch the original from the server rather than the uploading tab's
      // File object, which is gone after navigating from /chat or reloading.
      const res = await fetch(pdfUrl);
      if (!res.ok) throw new Error("The original document could not be loaded");
      const origBytes = await res.arrayBuffer();
      const pdfDoc = await PDFDocument.load(new Uint8Array(origBytes));

      // Verify the document loaded correctly
      if (pdfDoc.getPageCount() === 0) {
        throw new Error("PDF loaded with 0 pages");
      }

      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pdfPages = pdfDoc.getPages();

      // Strategy 1 — fill AcroForm fields by their exact field name
      let usedAcroForm = false;
      try {
        const form = pdfDoc.getForm();
        const formFields = form.getFields();
        if (formFields.length > 0) {
          for (const appField of fields) {
            if (!appField.value) continue;
            // Try both label and id as the AcroForm field name
            for (const key of [appField.label, appField.id]) {
              try {
                const f = form.getTextField(key);
                f.setText(appField.value);
                usedAcroForm = true;
                break;
              } catch { /* not found under this key */ }
            }
          }
          if (usedAcroForm) form.flatten();
        }
      } catch { /* no AcroForm */ }

      // Strategy 2 — draw text directly at field coordinates
      if (!usedAcroForm) {
        const hex = textStyle.color.replace("#", "");
        const rC = parseInt(hex.slice(0, 2), 16) / 255;
        const gC = parseInt(hex.slice(2, 4), 16) / 255;
        const bC = parseInt(hex.slice(4, 6), 16) / 255;

        for (const field of fields) {
          if (!field.value || !field.coordinates) continue;
          const pageIdx = field.page - 1;
          if (pageIdx >= pdfPages.length) continue;
          const page = pdfPages[pageIdx];
          const { width, height } = page.getSize();

          // PDF coordinate system: origin bottom-left
          const x = field.coordinates.x * width + 2;
          const fieldBottom = (field.coordinates.y + field.coordinates.height) * height;
          // Place text a bit above the bottom of the field box
          const y = height - fieldBottom + 4;

          page.drawText(field.value, {
            x,
            y: Math.max(2, y),
            size: textStyle.fontSize,
            font: helvetica,
            color: rgb(rC, gC, bC),
          });
        }
      }

      // Save and trigger download
      const savedBytes = await pdfDoc.save();
      // Use a copy of the underlying buffer to avoid SharedArrayBuffer issues
      const blob = new Blob([new Uint8Array(savedBytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "filled-form.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error("[FormDocument] export error", err);
      alert(`Export failed: ${String(err)}`);
    } finally {
      setExporting(false);
    }
  }, [sessionId, pdfUrl, fields, textStyle, exporting]);

  // Fields on the current page with coordinates
  const pageFields = fields.filter((f) => f.page === currentPage && f.coordinates);

  if (!pdfUrl) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 border-x border-gray-200 px-8">
        <div className="text-center max-w-sm">
          <p className="text-gray-500 text-sm font-medium">No document to preview</p>
          <p className="text-gray-400 text-xs mt-1.5 leading-relaxed">
            This session&apos;s fields are still editable here and in the chat — only the
            page preview is unavailable. Sessions created before documents were stored
            have no file to show.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white border-x border-gray-200 overflow-hidden">

      {/* ── Formatting toolbar ── */}
      <FormattingToolbar
        style={textStyle}
        onChange={(patch) => setTextStyle((s) => ({ ...s, ...patch }))}
        onExport={exportPdf}
        sessionId={sessionId}
      />

      {/* ── Page + zoom controls ── */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="p-1 rounded text-gray-400 hover:text-violet-600 hover:bg-violet-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="text-gray-500 text-xs">
            Page {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="p-1 rounded text-gray-400 hover:text-violet-600 hover:bg-violet-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight size={15} />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => { setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1))); setRenderKey((k) => k + 1); }}
            className="p-1 rounded text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
          >
            <ZoomOut size={14} />
          </button>
          <span className="text-gray-500 text-xs w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => { setZoom((z) => Math.min(3, +(z + 0.1).toFixed(1))); setRenderKey((k) => k + 1); }}
            className="p-1 rounded text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
          >
            <ZoomIn size={14} />
          </button>
        </div>
      </div>

      {/* ── PDF canvas + overlays ── */}
      <div className="flex-1 overflow-auto flex justify-center py-6 px-4 bg-gray-100">
        <div
          className="relative shadow-2xl"
          style={{ width: pageSize.width || "auto", height: pageSize.height || "auto" }}
        >
          {/* PDF rendered here */}
          <canvas ref={canvasRef} className="block" />

          {/* Inline editable field overlays */}
          {pageSize.width > 0 &&
            pageFields.map((field) => {
              const { x, y, width, height } = field.coordinates!;
              const isActive = field.id === activeFieldId;
              return (
                <div
                  key={field.id}
                  style={{
                    position: "absolute",
                    left: `${x * 100}%`,
                    top: `${y * 100}%`,
                    width: `${width * 100}%`,
                    height: `${height * 100}%`,
                  }}
                >
                  <InlineFieldInput
                    field={field}
                    style={textStyle}
                    isActive={isActive}
                    onFocus={() => setActiveField(field.id)}
                    onSave={saveField}
                  />
                </div>
              );
            })}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="px-4 py-1.5 border-t border-gray-100 bg-white flex items-center gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
          {fields.filter((f) => f.status === "filled").length} filled
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
          {fields.filter((f) => f.status === "missing").length} missing
        </span>
        <span className="ml-auto text-gray-600">{pageFields.length} fields on this page</span>
        {exporting && <span className="text-emerald-400 animate-pulse">Exporting…</span>}
      </div>
    </div>
  );
}
