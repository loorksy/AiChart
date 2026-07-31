import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasPlatformAccess } from "@/lib/platformAccess";
import { needsMcpCredentials } from "@/lib/userCredentials";
import { isLLMConfiguredAsync } from "@/lib/llm";
import { getChartLayoutById, getOrCreateChartLayout } from "@/lib/store";
import { canonicalizeInterval } from "@/lib/intervals";
import { initDb } from "@/lib/db";
import ChartPageClient from "@/components/ChartPageClient";
import { BRAND_NAME } from "@/lib/brand";

function cleanSymbol(raw: string): string {
  return decodeURIComponent(raw).toUpperCase().replace(/[^A-Z0-9.]/g, "");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const sym = cleanSymbol(symbol) || "الشارت";
  return {
    title: `${sym} — ${BRAND_NAME}`,
    description: `شارت ${sym} الذكي — تحليل AI، مستويات SL/TP، وإدارة الصفقات.`,
  };
}

/**
 * TradingView-style chart URLs:
 * - Signed-in: /chart/<layoutId>?symbol=EURUSD (per-user layout, drawings saved)
 * - Guest:     /chart/EURUSD (ephemeral)
 * A signed-in visit to /chart/<SYMBOL> redirects to the user's layout URL.
 */
export default async function ChartSymbolPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { symbol: rawParam } = await params;
  const search = await searchParams;
  const user = await getCurrentUser();
  if (user && needsMcpCredentials(user)) redirect("/complete-profile");
  if (user && user.role !== "admin" && !hasPlatformAccess(user)) {
    redirect("/awaiting-approval");
  }

  const raw = decodeURIComponent(rawParam);
  const agentReady = await isLLMConfiguredAsync();

  if (user) {
    await initDb();
    // Layout id? (case-sensitive alnum, 8–16 chars, owned by this user)
    const layout = /^[A-Za-z0-9]{8,16}$/.test(raw)
      ? await getChartLayoutById(raw, user.id)
      : null;

    if (layout) {
      const qsSymbol =
        typeof search.symbol === "string" ? cleanSymbol(search.symbol) : "";
      // An explicit ?interval= opens the chart on that timeframe instead of the
      // layout's saved one. Without this a multi-timeframe capture would render
      // the same frame four times, and a shared link could not name a frame.
      const qsInterval =
        typeof search.interval === "string"
          ? canonicalizeInterval(search.interval)
          : null;
      let state: import("@/components/SmartChartWorkspace").ChartLayoutState | null =
        null;
      try {
        state = layout.state_json ? JSON.parse(layout.state_json) : null;
      } catch {
        state = null;
      }
      return (
        <ChartPageClient
          email={user.email}
          role={user.role}
          agentReady={agentReady}
          guest={false}
          initialSymbol={qsSymbol || layout.symbol}
          layoutId={layout.id}
          initialInterval={qsInterval || layout.interval}
          initialState={state}
        />
      );
    }

    // Param is a symbol → send the user to their own layout URL.
    const sym = cleanSymbol(raw) || "EURUSD";
    const mine = await getOrCreateChartLayout(user.id, sym);
    redirect(`/chart/${mine.id}?symbol=${encodeURIComponent(sym)}`);
  }

  return (
    <ChartPageClient
      email={null}
      role="user"
      agentReady={agentReady}
      guest
      initialSymbol={cleanSymbol(raw) || undefined}
    />
  );
}
