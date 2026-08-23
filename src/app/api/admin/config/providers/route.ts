import { NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { requireAdminWith } from "@/lib/adminRoles";
import {
  getActiveProviderAsync,
  isProviderReadyAsync,
  LLM_PROVIDERS,
  providerKeyField,
  resolveActiveSelection,
  type LLMProvider,
} from "@/lib/llm";
import { readProviderHealth } from "@/lib/providerHealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface ProviderStatus {
  id: LLMProvider;
  label: string;
  /** The one the platform is pointed at right now. */
  active: boolean;
  keyConfigured: boolean;
  keyField: string;
  /** The model this provider would answer with, when it is the active one. */
  model: string | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureCode: string | null;
}

/**
 * Per-provider status for the keys panel.
 *
 * The panel used to show only which provider was SELECTED. When one
 * provider's account ran out of credit the failure read as "the AI is
 * down" — with no way to see which account it was — and the operator
 * topped up the provider that was working. Active, key-present, and the
 * last real outcome per provider make that unambiguous.
 */
export async function GET() {
  try {
    await requireAdminWith("keys_write");
    const [active, health] = await Promise.all([
      getActiveProviderAsync(),
      readProviderHealth(),
    ]);
    const activeSelection = await resolveActiveSelection("deep");

    const providers: ProviderStatus[] = await Promise.all(
      LLM_PROVIDERS.map(async (p) => {
        const row = health.get(p.id);
        return {
          id: p.id,
          label: p.label,
          active: p.id === active,
          keyConfigured: await isProviderReadyAsync(p.id),
          keyField: providerKeyField(p.id),
          model: p.id === active ? activeSelection.model : null,
          lastSuccessAt: row?.last_success_at ?? null,
          lastFailureAt: row?.last_failure_at ?? null,
          lastFailureCode: row?.last_failure_code ?? null,
        };
      }),
    );

    return NextResponse.json({ ok: true, active, providers });
  } catch (err) {
    return handleError(err);
  }
}
