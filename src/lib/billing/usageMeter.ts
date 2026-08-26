import { AsyncLocalStorage } from "node:async_hooks";
import { execute, queryOne } from "@/lib/db";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { createLogger } from "@/lib/logger";

const log = createLogger("billing.usage");

/**
 * V2-A1 (#90): every LLM call becomes one `usage_events` row.
 *
 * The route boundary declares WHO is spending (withUsageContext); llm.ts
 * declares WHAT was spent (recordLLMUsage with the provider's own token
 * counts). Recording is fire-and-forget: a metering failure must never fail
 * or slow the user's analysis — it logs and moves on. Calls with no context
 * are recorded with user_id NULL so platform-wide spend still adds up.
 */

export interface UsageContext {
  userId: number | null;
  /** What the spend was for: analysis | chat | voice | scan | support_bot | other. */
  kind: string;
  requestId?: string;
}

const usageContext = new AsyncLocalStorage<UsageContext>();

export function withUsageContext<T>(ctx: UsageContext, fn: () => T): T {
  return usageContext.run(ctx, fn);
}

export function currentUsageContext(): UsageContext | undefined {
  return usageContext.getStore();
}

/**
 * Provider list prices seeded once (USD per 1M tokens, 2026-07 rates).
 * `model_prices` stays the source of truth afterwards — admins edit it and
 * reseeding never overwrites an edited row.
 */
const SEED_PRICES: Array<[provider: string, model: string, inUsd: number, outUsd: number]> = [
  ["openai", "gpt-5.6-sol", 5, 30],
  ["openai", "gpt-5.6-terra", 2, 12],
  ["openai", "gpt-5.6-luna", 0.2, 1.2],
  ["anthropic", "claude-fable-5", 10, 50],
  ["anthropic", "claude-opus-5", 5, 25],
  ["anthropic", "claude-opus-4-8", 5, 25],
  ["anthropic", "claude-sonnet-5", 3, 15],
  ["anthropic", "claude-haiku-4-5", 1, 5],
];

let seeded = false;
export async function ensureSeedPrices(): Promise<void> {
  if (seeded) return;
  seeded = true;
  for (const [provider, model, inUsd, outUsd] of SEED_PRICES) {
    try {
      const existing = await queryOne(
        "SELECT provider FROM model_prices WHERE provider = ? AND model = ?",
        [provider, model],
      );
      if (!existing) {
        await execute(
          "INSERT INTO model_prices (provider, model, input_usd_per_m, output_usd_per_m, updated_at) VALUES (?, ?, ?, ?, ?)",
          [provider, model, inUsd, outUsd, Date.now()],
        );
      }
    } catch (e) {
      // Concurrent seeding races are benign; anything else is logged below.
      log.debug("seed.skip", { model, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

interface PriceRow {
  input_usd_per_m: number;
  output_usd_per_m: number;
}

/** Normalize stored/legacy ids ("openai/gpt-…", date-suffixed) to price keys. */
function priceModelKey(_provider: string, model: string): string {
  return model.replace(/^openai\//, "").toLowerCase();
}

async function lookupPrice(provider: string, model: string): Promise<PriceRow | null> {
  await ensureSeedPrices();
  return queryOne<PriceRow>(
    "SELECT input_usd_per_m, output_usd_per_m FROM model_prices WHERE provider = ? AND model = ?",
    [provider, priceModelKey(provider, model)],
  );
}

/**
 * Retail multiplier over provider cost. Stored in platform_config
 * (`BILLING_RETAIL_MULTIPLIER`) so the real margin lives in the database,
 * not in this public repository. Default 1 = at cost. Cached briefly —
 * this sits on the hot path of every LLM call.
 */
let multiplierCache: { value: number; at: number } | null = null;
async function retailMultiplier(): Promise<number> {
  if (multiplierCache && Date.now() - multiplierCache.at < 60_000) {
    return multiplierCache.value;
  }
  let value = 1;
  try {
    const raw = await getPlatformValueAsync("BILLING_RETAIL_MULTIPLIER");
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 1) value = parsed;
  } catch {
    /* default stands */
  }
  multiplierCache = { value, at: Date.now() };
  return value;
}

export interface LLMUsageEntry {
  provider: string;
  model: string;
  /** Uncached input tokens (after the last cache breakpoint). */
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from the provider's prompt cache (heavily discounted). */
  cacheReadTokens?: number;
  /** Tokens written to the provider's prompt cache (surcharged ~1.25×). */
  cacheWriteTokens?: number;
}

/**
 * Provider cache pricing relative to the base input rate.
 * Anthropic documents 0.1× reads / 1.25× writes (5-minute TTL). OpenAI's
 * newest models (gpt-5.6+) document the same shape; gpt-4.1-era models bill
 * cached reads at 0.25× and report no cache writes.
 */
export function cacheMultipliers(
  provider: string,
  model: string,
): { read: number; write: number } {
  if (provider === "anthropic") return { read: 0.1, write: 1.25 };
  const id = model.toLowerCase();
  if (/^gpt-5\.[6-9]|^gpt-[6-9]/.test(id)) return { read: 0.1, write: 1.25 };
  if (/^gpt-4\.1/.test(id)) return { read: 0.25, write: 1 };
  return { read: 0.5, write: 1 };
}

export interface CacheCostInput {
  readTokens: number;
  writeTokens: number;
  readMultiplier: number;
  writeMultiplier: number;
}

export function computeCosts(
  price: PriceRow | null,
  inputTokens: number,
  outputTokens: number,
  multiplier: number,
  cache?: CacheCostInput,
): { provider: number | null; retail: number | null } {
  if (!price) return { provider: null, retail: null };
  const cacheUsd = cache
    ? (cache.readTokens * cache.readMultiplier +
        cache.writeTokens * cache.writeMultiplier) *
      price.input_usd_per_m
    : 0;
  const provider =
    (inputTokens * price.input_usd_per_m +
      cacheUsd +
      outputTokens * price.output_usd_per_m) /
    1_000_000;
  return { provider, retail: provider * multiplier };
}

/**
 * Fire-and-forget. Never throws, never awaited by callers on the hot path.
 * A model missing from `model_prices` records NULL costs — visible in admin
 * as a pricing gap instead of silently costing zero.
 */
export function recordLLMUsage(entry: LLMUsageEntry): void {
  const ctx = usageContext.getStore();
  void (async () => {
    try {
      const cacheRead = entry.cacheReadTokens ?? 0;
      const cacheWrite = entry.cacheWriteTokens ?? 0;
      if (
        entry.inputTokens <= 0 &&
        entry.outputTokens <= 0 &&
        cacheRead <= 0 &&
        cacheWrite <= 0
      ) {
        return;
      }
      const price = await lookupPrice(entry.provider, entry.model);
      const multipliers = cacheMultipliers(entry.provider, entry.model);
      const costs = computeCosts(
        price,
        entry.inputTokens,
        entry.outputTokens,
        await retailMultiplier(),
        {
          readTokens: cacheRead,
          writeTokens: cacheWrite,
          readMultiplier: multipliers.read,
          writeMultiplier: multipliers.write,
        },
      );
      await execute(
        `INSERT INTO usage_events
           (user_id, ts, provider, model, kind, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, provider_cost_usd, retail_cost_usd, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ctx?.userId ?? null,
          Date.now(),
          entry.provider,
          priceModelKey(entry.provider, entry.model),
          ctx?.kind ?? "other",
          entry.inputTokens,
          entry.outputTokens,
          cacheRead,
          cacheWrite,
          costs.provider,
          costs.retail,
          ctx?.requestId ?? null,
        ],
      );
      if (!price) {
        log.warn("price.missing", {
          provider: entry.provider,
          model: priceModelKey(entry.provider, entry.model),
        });
      }
      // Billing v3: usage_events stays the platform's COST measurement, but
      // token cost no longer drains anyone's balance — users pay the
      // admin-set credit price per OPERATION (spend.ts), not per token. The
      // legacy USD ledger is read-only history now.
    } catch (e) {
      log.warn("record.failed", { error: e instanceof Error ? e.message : String(e) });
    }
  })();
}
