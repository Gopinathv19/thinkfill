"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import TopBar from "@/components/TopBar";
import FormNavigator from "@/components/FormNavigator";
import FormDocument from "@/components/FormDocument";
import AIAssistant from "@/components/AIAssistant";
import UploadDropzone from "@/components/UploadDropzone";
import { useFormContext } from "@/context/FormContext";

export default function WorkspacePage() {
  const { sessionId, isLoading, rehydrateSession } = useFormContext();
  const searchParams = useSearchParams();
  const rehydratedRef = useRef(false);

  // If a ?session=xxx param is present and we have no active session, rehydrate
  useEffect(() => {
    const param = searchParams.get("session");
    if (param && !sessionId && !rehydratedRef.current) {
      rehydratedRef.current = true;
      rehydrateSession(param);
    }
  }, [searchParams, sessionId, rehydrateSession]);

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-white">
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
            <p className="text-gray-500 text-sm">
              {searchParams.get("session") && !sessionId
                ? "Restoring your session…"
                : "Analysing PDF and extracting fields…"}
            </p>
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
