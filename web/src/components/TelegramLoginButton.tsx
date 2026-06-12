"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TelegramLoginPayload } from "@/lib/telegramAuth";

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramLoginPayload) => void;
  }
}

export function TelegramLoginButton({
  botUsername,
  redirectTo,
  onError,
}: {
  botUsername: string;
  redirectTo?: string;
  onError?: (msg: string) => void;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const container = ref.current;
    if (!container || !botUsername) return;

    window.onTelegramAuth = async (user: TelegramLoginPayload) => {
      setBusy(true);
      try {
        const res = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...user, redirectTo }),
        });
        const data = await res.json();
        if (!res.ok) {
          onError?.(data.error ?? "فشل تسجيل الدخول عبر تليجرام.");
          return;
        }
        router.push(data.redirect ?? "/console");
        router.refresh();
      } catch {
        onError?.("تعذّر الاتصال بالخادم.");
      } finally {
        setBusy(false);
      }
    };

    container.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    container.appendChild(script);

    return () => {
      delete window.onTelegramAuth;
      container.innerHTML = "";
    };
  }, [botUsername, redirectTo, onError, router]);

  return (
    <div className="space-y-2">
      <div
        ref={ref}
        className="flex min-h-[44px] items-center justify-center"
        aria-busy={busy}
      />
      {busy && (
        <p className="text-center text-xs text-muted-foreground">
          جارٍ تسجيل الدخول وربط البوت…
        </p>
      )}
    </div>
  );
}
