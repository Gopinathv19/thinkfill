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

  const [restoreFailed, setRestoreFailed] = useState(false);

  // Reopen a session linked from /chat or the sidebar.
  useEffect(() => {
    const param = searchParams.get("session");
    if (!param || sessionId || rehydratedRef.current) return;
    rehydratedRef.current = true;
    setIsRestoring(true);
    rehydrateSession(param).finally(() => setIsRestoring(false));
  }, [searchParams, sessionId, rehydrateSession]);

  // Once a restore attempt has finished with no session, there is nothing to
  // show — the session was deleted, or the link is stale.
  useEffect(() => {
    if (isLoading || sessionId || !rehydratedRef.current) return;
    setRestoreFailed(true);
  }, [isLoading, sessionId]);

  // The workspace always operates on a session; uploads happen in /chat. This
  // covers arriving with no session at all, and a session that would not load
  // — either would otherwise sit on a spinner with nothing left to wait for.
  useEffect(() => {
    if (isLoading || sessionId) return;
    if (!searchParams.get("session") || restoreFailed) {
      router.replace("/chat");
    }
  }, [searchParams, sessionId, isLoading, restoreFailed, router]);

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
