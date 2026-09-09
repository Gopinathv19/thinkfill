"use client";

import { useState } from "react";
import ChatSidebar from "@/components/ChatSidebar";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | undefined>(undefined);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-white">
      <ChatSidebar activeId={activeId} onSelect={setActiveId} />
      <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
    </div>
  );
}
