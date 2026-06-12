"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, PanelTopOpen, Settings2 } from "lucide-react";
import { SurfaceCard } from "@/components/ui/shell";

export function OpenClawConsoleClient() {
  const [webUiUrl, setWebUiUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/openclaw-console", {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        webUiUrl?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "تعذّر تحميل رابط اللوحة.");
        setWebUiUrl(null);
        return;
      }
      setWebUiUrl(data.webUiUrl ?? null);
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SurfaceCard>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
        <Settings2 className="h-5 w-5 text-muted-foreground" />
        لوحة OpenClaw (Control Web UI)
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        قنوات Telegram، tools.exec، موافقات الأوامر، heartbeat، plugins، skills —
        من تبويب Config داخل اللوحة.
      </p>
      <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
        <strong>النموذج (Gemini / Claude):</strong> يُضبط من{" "}
        <a href="/console/platform" className="underline">
          /console/platform
        </a>{" "}
        فقط — لا تغيّر Model من Quick Settings في OpenClaw؛ التغيير اليدوي
        يُبقي نماذج قديمة ويُفسد المزامنة مع المنصة.
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>
      )}
      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {!loading && webUiUrl && (
        <div className="flex flex-wrap gap-3">
          <a href={webUiUrl} className="btn btn-primary gap-2">
            <PanelTopOpen className="h-4 w-4" />
            فتح لوحة OpenClaw
          </a>
          <a
            href={webUiUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary gap-2"
          >
            <ExternalLink className="h-4 w-4" />
            فتح في تبويب جديد
          </a>
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        المسار العام:{" "}
        <code dir="ltr">/openclaw/</code> — يتطلب token من هذه الصفحة (أدمن
        فقط). لا تستخدم iframe؛ افتح الصفحة مباشرة.
      </p>
    </SurfaceCard>
  );
}
