"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/squareui/button";

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
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-xl rounded-[var(--radius-lg)] border border-border bg-card/95 p-4 elevation-3 backdrop-blur-md"
    >
      <p className="text-sm leading-relaxed text-foreground">
        نستخدم ملفات تعريف ارتباط أساسية لتشغيل المنصة (الجلسة والتفضيلات) ولا
        نستخدم أي متتبعات طرف ثالث. التفاصيل في{" "}
        <a
          href="/p/privacy-policy"
          className="rounded-sm text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          سياسة الخصوصية
        </a>
        .
      </p>
      <div className="mt-3 flex gap-2">
        <Button type="button" size="xl" onClick={() => choose("all")}>
          موافق
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xl"
          onClick={() => choose("essential")}
        >
          الأساسية فقط
        </Button>
      </div>
    </div>
  );
}
