"use client";

import { useEffect, useState } from "react";

const KEY = "aichart_cookie_consent";

/**
 * V2-C (#97): consent banner. The platform sets only essential cookies
 * (session + preferences) and loads no third-party trackers, so "decline
 * non-essential" is genuinely honored by construction — the banner records
 * the choice and nothing conditional ever loads before (or after) it.
 */
export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setVisible(true);
    } catch {
      /* storage blocked → keep quiet */
    }
  }, []);

  const choose = (value: "all" | "essential") => {
    try {
      localStorage.setItem(KEY, value);
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-label="موافقة ملفات تعريف الارتباط"
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-xl rounded-2xl border border-border bg-card/95 p-4 shadow-xl backdrop-blur-md"
    >
      <p className="text-sm leading-relaxed text-foreground">
        نستخدم ملفات تعريف ارتباط أساسية لتشغيل المنصة (الجلسة والتفضيلات) ولا
        نستخدم أي متتبعات طرف ثالث. التفاصيل في{" "}
        <a href="/p/privacy-policy" className="text-primary underline">
          سياسة الخصوصية
        </a>
        .
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => choose("all")}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          موافق
        </button>
        <button
          onClick={() => choose("essential")}
          className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted"
        >
          الأساسية فقط
        </button>
      </div>
    </div>
  );
}
