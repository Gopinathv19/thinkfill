"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import TopBar from "@/components/TopBar";
import FormNavigator from "@/components/FormNavigator";
import FormDocument from "@/components/FormDocument";
import AIAssistant from "@/components/AIAssistant";
import { useFormContext } from "@/context/FormContext";

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-500 text-sm">{label}</p>
      </div>
    </div>
  );
}

function WorkspaceContent() {
  const { sessionId, isLoading, rehydrateSession } = useFormContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rehydratedRef = useRef(false);
  // Tracked separately from the URL so the loading copy stays correct after
  // the session is restored and the param is no longer the reason we're busy.
  const [isRestoring, setIsRestoring] = useState(false);

  // Reopen a session linked from /chat or the sidebar.
  useEffect(() => {
    const param = searchParams.get("session");
    if (!param || sessionId || rehydratedRef.current) return;
    rehydratedRef.current = true;
    setIsRestoring(true);
    rehydrateSession(param).finally(() => setIsRestoring(false));
  }, [searchParams, sessionId, rehydrateSession]);

  // The workspace always operates on a session; uploads happen in /chat.
  useEffect(() => {
    if (!searchParams.get("session") && !sessionId && !isLoading) {
      router.replace("/chat");
    }
  }, [searchParams, sessionId, isLoading, router]);

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-white">
      <TopBar />

      {!sessionId && !isLoading && <Spinner label="Taking you to the chat…" />}

      {isLoading && (
        <Spinner label={isRestoring ? "Restoring your session…" : "Analysing PDF and extracting fields…"} />
      )}

      {sessionId && !isLoading && (
        <div className="flex flex-1 overflow-hidden">
          <FormNavigator />
          <FormDocument />
          <AIAssistant />
        </div>
      )}
    </div>
  );
}

export default function WorkspacePage() {
  // useSearchParams opts the subtree out of static prerendering, so it must sit
  // behind a Suspense boundary or the production build fails.
  return (
    <Suspense
      fallback={
        <div className="flex flex-col h-screen w-full overflow-hidden bg-white">
          <TopBar />
          <Spinner label="Loading workspace…" />
        </div>
      }
    >
      <WorkspaceContent />
    </Suspense>
  );
}
