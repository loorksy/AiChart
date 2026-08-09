import { NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { DEFAULT_ANTHROPIC_MODEL } from "@/lib/anthropic";
import {
  ANTHROPIC_MODEL_CHOICES,
  OPENAI_MODEL_CHOICES,
  OPENROUTER_MODEL_CHOICES,
} from "@/lib/modelCatalog";
import {
  isOpenRouterEnabledAsync,
  parsePlatformProvider,
} from "@/lib/llm";
import { getSettings } from "@/lib/store";

export interface AgentModelOption {
  /** "provider/model" — what the client stores as the preference. */
  ref: string;
  provider: "openai" | "anthropic" | "openrouter";
  model: string;
  label: string;
}

/**
 * Models THIS user may pick from, for the chat composer's model selector.
 *
 * The list is the platform's curated catalogue, not the provider's: an API key
 * exposes dozens of ids the platform never vetted, and offering them all put
 * broken or unintended choices one tap away. A provider appears only when the
 * operator has configured its key — the admin owns credentials, the user picks
 * among the committed models. OpenRouter additionally requires the admin
 * enable toggle (test-only). Never exposes key material.
 */
export async function GET() {
  try {
    const user = await requirePaidAccess();
    const [
      openaiKey,
      anthropicKey,
      openrouterKey,
      openrouterEnabled,
      defaultProvider,
      defaultOpenAiModel,
      defaultClaudeModel,
      defaultOpenRouterModel,
    ] = await Promise.all([
      getPlatformValueAsync("OPENAI_API_KEY"),
      getPlatformValueAsync("ANTHROPIC_API_KEY"),
      getPlatformValueAsync("OPENROUTER_API_KEY"),
      isOpenRouterEnabledAsync(),
      getPlatformValueAsync("AI_PROVIDER"),
      getPlatformValueAsync("AI_MODEL"),
      getPlatformValueAsync("ANTHROPIC_MODEL"),
      getPlatformValueAsync("OPENROUTER_MODEL"),
    ]);

    const options: AgentModelOption[] = [];

    if (openaiKey) {
      options.push(
        ...OPENAI_MODEL_CHOICES.map((m) => ({
          ref: `openai/${m.id}`,
          provider: "openai" as const,
          model: m.id,
          label: m.label,
        })),
      );
      // The admin's configured default must stay pickable even if it predates
      // (or was deliberately set outside) the curated catalogue.
      const adminModel = defaultOpenAiModel?.trim();
      if (adminModel && !OPENAI_MODEL_CHOICES.some((m) => m.id === adminModel)) {
        options.push({
          ref: `openai/${adminModel}`,
          provider: "openai",
          model: adminModel,
          label: adminModel,
        });
      }
    }

    if (anthropicKey) {
      options.push(
        ...ANTHROPIC_MODEL_CHOICES.map((m) => ({
          ref: `anthropic/${m.id}`,
          provider: "anthropic" as const,
          model: m.id,
          label: m.label,
        })),
      );
    }

    if (openrouterKey && openrouterEnabled) {
      options.push(
        ...OPENROUTER_MODEL_CHOICES.map((m) => ({
          ref: `openrouter/${m.id}`,
          provider: "openrouter" as const,
          model: m.id,
          label: m.label,
        })),
      );
      const adminOrModel = defaultOpenRouterModel?.trim();
      if (
        adminOrModel &&
        !OPENROUTER_MODEL_CHOICES.some((m) => m.id === adminOrModel)
      ) {
        options.push({
          ref: `openrouter/${adminOrModel}`,
          provider: "openrouter",
          model: adminOrModel,
          label: adminOrModel,
        });
      }
    }

    const settings = await getSettings(user.id);
    const provider = parsePlatformProvider(defaultProvider);
    const platformDefault =
      provider === "anthropic"
        ? `anthropic/${defaultClaudeModel?.trim() || DEFAULT_ANTHROPIC_MODEL}`
        : provider === "openrouter"
          ? `openrouter/${defaultOpenRouterModel?.trim() || "openai/gpt-4o-mini"}`
          : `openai/${defaultOpenAiModel?.trim() || "gpt-4.1"}`;

    return NextResponse.json({
      models: options,
      selected: settings.preferred_model_ref ?? null,
      platformDefault,
      // The picker is meaningless without a key; the UI hides itself instead of
      // offering a choice that cannot work.
      configured: options.length > 0,
    });
  } catch (err) {
    return handleError(err);
  }
}
