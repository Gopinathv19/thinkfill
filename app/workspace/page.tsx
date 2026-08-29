"use client";

import TopBar from "@/components/TopBar";
import FormNavigator from "@/components/FormNavigator";
import FormDocument from "@/components/FormDocument";
import AIAssistant from "@/components/AIAssistant";
import UploadDropzone from "@/components/UploadDropzone";
import { useFormContext } from "@/context/FormContext";

export default function WorkspacePage() {
  const { sessionId, isLoading } = useFormContext();

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-[#0f0f11]">
      {/* Top navigation bar */}
      <TopBar />

      {/* Show upload screen if no session is active */}
      {!sessionId && !isLoading && (
        <div className="flex flex-1 items-center justify-center">
          <UploadDropzone />
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">Analysing PDF and extracting fields…</p>
          </div>
        </div>
      )}

      {/* Three-panel workspace — shown once PDF is processed */}
      {sessionId && !isLoading && (
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Form Navigator */}
          <FormNavigator />

          {/* Center: Document viewer */}
          <FormDocument />

          {/* Right: AI Assistant */}
          <AIAssistant />
        </div>
      )}
    </div>
  );
}
