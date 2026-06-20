"use client";

import { useState } from "react";
import { AppConsoleShell } from "@/components/shell/AppConsoleShell";
import ChatSquareClient from "@/components/ChatSquareClient";

/** Local, dependency-free display name (avoids importing server-only userContext). */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export default function ChatPageClient({
  email,
  role,
  agentReady,
}: {
  email: string;
  role: "user" | "admin";
  agentReady: boolean;
}) {
  const [, setCreditsKey] = useState(0);

  return (
    <AppConsoleShell role={role} displayName={nameFromEmail(email)} noPadding>
      <div className="flex h-[calc(100dvh-3.25rem)] flex-col lg:h-dvh">
        <ChatSquareClient
          agentReady={agentReady}
          onCreditsUsed={() => setCreditsKey((k) => k + 1)}
        />
      </div>
    </AppConsoleShell>
  );
}
