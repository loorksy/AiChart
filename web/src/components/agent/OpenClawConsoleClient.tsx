"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, PanelTopOpen, Settings2 } from "lucide-react";
import { SurfaceCard } from "@/components/ui/shell";

export function OpenClawConsoleClient() {
  const [webUiUrl, setWebUiUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openclawEnabled, setOpenclawEnabled] = useState(true);
  const [agentModel, setAgentModel] = useState<{
    platformRef: string;
    gatewayPrimary: string | null;
    inSync: boolean;
    openclawEnabled?: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [consoleRes, modelRes] = await Promise.all([
        fetch("/api/admin/openclaw-console", { cache: "no-store" }),
        fetch("/api/admin/agent-model-status", { cache: "no-store" }),
      ]);
      const data = (await consoleRes.json()) as {
        webUiUrl?: string;
        error?: string;
        openclawEnabled?: boolean;
      };
      if (modelRes.ok) {
        const modelData = await modelRes.json();
        setAgentModel(modelData);
        if (modelData.openclawEnabled === false) {
          setOpenclawEnabled(false);
          setWebUiUrl(null);
          setLoading(false);
          return;
        }
      }
      if (!consoleRes.ok) {
        if (data.openclawEnabled === false) {
          setOpenclawEnabled(false);
          setWebUiUrl(null);
        } else {
          setError(data.error ?? "تعذّر تحميل رابط اللوحة.");
          setWebUiUrl(null);
        }
      } else {
        setWebUiUrl(data.webUiUrl ?? null);
      }
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!loading && !openclawEnabled) {
    return (
      <SurfaceCard>
        <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
          <Settings2 className="h-5 w-5 text-muted-foreground" />
          Claude MCP (القناة الأساسية)
        </h2>
        <p className="text-sm text-muted-foreground">
          OpenClaw معطّل على هذا الخادم. استخدم{" "}
          <a
            href="https://claude.ai/customize/connectors"
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Claude Connectors
          </a>{" "}
          مع عنوان MCP: <code dir="ltr">/mcp</code>
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          راجع <code>docs/MCP_CLAUDE_SETUP.md</code> في المستودع.
        </p>
      </SurfaceCard>
    );
  }

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
      <div className="mb-4 space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
        <p>
          <strong>النموذج:</strong> يُضبط من{" "}
          <a href="/console/platform" className="underline">
            /console/platform
          </a>{" "}
          فقط — لا تغيّر Model من Quick Settings في OpenClaw.
        </p>
        {agentModel && (
          <p className="text-xs">
            Quick Settings قد تعرض <code dir="ltr">default</code> — هذا يعني
            استخدام النموذج العالمي من المنصة:{" "}
            <code dir="ltr">
              {agentModel.inSync
                ? agentModel.gatewayPrimary
                : agentModel.platformRef}
            </code>
            {!agentModel.inSync && agentModel.gatewayPrimary && (
              <>
                {" "}
                (Gateway حالياً:{" "}
                <code dir="ltr">{agentModel.gatewayPrimary}</code> — احفظ من
                المنصة لمزامنة)
              </>
            )}
          </p>
        )}
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
