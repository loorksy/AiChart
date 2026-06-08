"use client";

import { useState } from "react";
import AppShell from "@/components/AppShell";
import ChatSquareClient from "@/components/ChatSquareClient";

export default function ChatPageClient({
  email,
  role,
  agentReady,
}: {
  email: string;
  role: "user" | "admin";
  agentReady: boolean;
}) {
  const [creditsKey, setCreditsKey] = useState(0);

  return (
    <AppShell
      email={email}
      role={role}
      chatLayout
      creditsRefreshKey={creditsKey}
    >
      <ChatSquareClient
        agentReady={agentReady}
        onCreditsUsed={() => setCreditsKey((k) => k + 1)}
      />
    </AppShell>
  );
}
