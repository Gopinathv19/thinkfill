"use client";

import { useCallback, useRef, useState } from "react";
import { useFormContext } from "@/context/FormContext";
import { Upload, FileText, AlertCircle } from "lucide-react";

export default function UploadDropzone() {
  const { uploadPdf, uploadError } = useFormContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        alert("Please upload a PDF file.");
        return;
      }
      uploadPdf(file);
    },
    [uploadPdf]
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => setIsDragging(false);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-xl px-6">
      {/* Logo / branding */}
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center">
            <FileText size={20} className="text-white" />
          </div>
          <span className="text-2xl font-bold text-white tracking-tight">ThinkFill</span>
        </div>
        <p className="text-gray-400 text-center text-sm leading-relaxed max-w-xs">
          Upload a fillable PDF form and let our AI agent complete it using your saved profile.
        </p>
      </div>

      {/* Drop zone */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`w-full border-2 border-dashed rounded-2xl p-12 flex flex-col items-center gap-4 transition-all cursor-pointer focus:outline-none
          ${isDragging
            ? "border-violet-500 bg-violet-500/10"
            : "border-gray-700 bg-gray-900/50 hover:border-violet-600 hover:bg-gray-900"
          }`}
      >
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-colors
          ${isDragging ? "bg-violet-500/20" : "bg-gray-800"}`}>
          <Upload size={28} className={isDragging ? "text-violet-400" : "text-gray-500"} />
        </div>
        <div className="flex flex-col items-center gap-1">
          <p className="text-white font-medium text-base">
            {isDragging ? "Drop your PDF here" : "Drag & drop your PDF"}
          </p>
          <p className="text-gray-500 text-sm">or click to browse files</p>
        </div>
        <div className="px-4 py-1.5 rounded-full bg-violet-600 text-white text-xs font-medium">
          Browse PDF
        </div>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={onChange}
      />

      {/* Error */}
      {uploadError && (
        <div className="flex items-start gap-2 p-3 bg-red-950/50 border border-red-800 rounded-lg w-full">
          <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-red-300 text-sm">{uploadError}</p>
        </div>
      )}

      {/* Supported hint */}
      <p className="text-gray-600 text-xs text-center">
        Supports fillable PDFs with AcroForm fields · Government, banking, university & application forms
      </p>
    </div>
  );
}
