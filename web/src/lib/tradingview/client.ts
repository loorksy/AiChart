import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import type { MarketType } from "@/lib/markets/types";

export interface TradingViewFrame {
  ok?: boolean;
  recommendation?: string;
  rsi?: number;
  macd?: number;
  ema20?: number;
  ema50?: number;
  close?: number;
  error?: string;
}

export interface TradingViewContext {
  ok: boolean;
  market: MarketType;
  symbol: string;
  interval: string;
  primary?: TradingViewFrame;
  multiTimeframe?: {
    alignment?: string;
    frames?: Record<string, TradingViewFrame>;
  };
  error?: string;
  skipped?: boolean;
}

const memoryCache = new Map<string, { at: number; data: TradingViewContext }>();
const TTL_MS = 60_000;

function bridgePath(): string {
  const candidates = [
    path.join(process.cwd(), "infra", "tradingview", "bridge.py"),
    path.join(process.cwd(), "..", "infra", "tradingview", "bridge.py"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0]!;
}

function isEnabled(): boolean {
  return process.env.TRADINGVIEW_MCP_ENABLED === "1";
}

function runBridge(
  market: MarketType,
  symbol: string,
  interval: string,
): Promise<TradingViewContext> {
  return new Promise((resolve) => {
    const py = process.platform === "win32" ? "py" : "python3";
    const script = bridgePath();
    const child = spawn(py, [script, market, symbol.toUpperCase(), interval], {
      timeout: 25_000,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      resolve({
        ok: false,
        market,
        symbol,
        interval,
        error: err.message,
      });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          market,
          symbol,
          interval,
          error: stderr.trim() || `bridge exit ${code}`,
        });
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as TradingViewContext;
        resolve(parsed);
      } catch {
        resolve({
          ok: false,
          market,
          symbol,
          interval,
          error: "invalid bridge JSON",
        });
      }
    });
  });
}

export async function fetchTradingViewContext(
  symbol: string,
  interval: string,
  market: MarketType,
): Promise<TradingViewContext | null> {
  if (!isEnabled()) {
    return { ok: false, market, symbol, interval, skipped: true };
  }

  const key = `${market}:${symbol}:${interval}`;
  const cached = memoryCache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return cached.data;
  }

  const data = await runBridge(market, symbol, interval);
  memoryCache.set(key, { at: Date.now(), data });
  return data;
}

export function formatTradingViewForPrompt(ctx: TradingViewContext | null): string {
  if (!ctx || ctx.skipped) return "";
  if (!ctx.ok) {
    return ctx.error
      ? `TradingView TA (غير متاح): ${ctx.error}`
      : "";
  }

  const lines: string[] = ["## TradingView TA (مصدر خارجي)"];

  const p = ctx.primary;
  if (p?.ok) {
    lines.push(
      `الإطار ${ctx.interval}: ${p.recommendation ?? "—"} | RSI ${p.rsi?.toFixed?.(1) ?? "—"} | MACD ${p.macd?.toFixed?.(4) ?? "—"} | EMA20 ${p.ema20?.toFixed?.(2) ?? "—"}`,
    );
  }

  const mtf = ctx.multiTimeframe;
  if (mtf?.alignment) {
    lines.push(`توافق MTF: ${mtf.alignment}`);
  }
  if (mtf?.frames) {
    for (const [fr, frame] of Object.entries(mtf.frames)) {
      if (frame.ok && frame.recommendation) {
        lines.push(`  ${fr}: ${frame.recommendation} (RSI ${frame.rsi?.toFixed?.(1) ?? "—"})`);
      }
    }
  }

  return lines.join("\n");
}
