/**
 * What each AI provider last actually DID for us.
 *
 * The panel could say which provider was selected and whether a key was on
 * file, but not which provider was failing — so an exhausted OpenAI account
 * read as "the AI is broken", and the operator topped up Anthropic instead.
 * Every provider call records its outcome here, and the keys panel shows it
 * per provider: active, key configured, last success, last failure and its
 * kind.
 *
 * Recording is best-effort and never blocks a call: a health write that
 * fails must not turn a working answer into an error.
 */
import { execute, query } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import type { LLMProvider } from "@/lib/providerIdentity";

const log = createLogger("provider.health");

export interface ProviderHealthRow {
  provider: string;
  last_success_at: number | null;
  last_failure_at: number | null;
  last_failure_code: string | null;
  last_failure_note: string | null;
}

export async function recordProviderSuccess(provider: LLMProvider): Promise<void> {
  try {
    await execute(
      `INSERT INTO provider_health (provider, last_success_at)
       VALUES (?, ?)
       ON CONFLICT(provider) DO UPDATE SET last_success_at = excluded.last_success_at`,
      [provider, Date.now()],
    );
  } catch (err) {
    log.debug("health success write failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function recordProviderFailure(
  provider: LLMProvider,
  code: string,
  note?: string,
): Promise<void> {
  try {
    await execute(
      `INSERT INTO provider_health (provider, last_failure_at, last_failure_code, last_failure_note)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET
         last_failure_at   = excluded.last_failure_at,
         last_failure_code = excluded.last_failure_code,
         last_failure_note = excluded.last_failure_note`,
      // The note is operator-only diagnostics; bounded so a provider's own
      // verbose payload can never bloat the row.
      [provider, Date.now(), code, (note ?? "").slice(0, 300)],
    );
  } catch (err) {
    log.debug("health failure write failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function readProviderHealth(): Promise<Map<string, ProviderHealthRow>> {
  try {
    const rows = await query<ProviderHealthRow>(
      "SELECT provider, last_success_at, last_failure_at, last_failure_code, last_failure_note FROM provider_health",
    );
    return new Map(rows.map((r: ProviderHealthRow) => [r.provider, r] as const));
  } catch {
    return new Map();
  }
}
