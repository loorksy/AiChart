import { NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { DEFAULT_ANTHROPIC_MODEL } from "@/lib/anthropic";
import {
  ANTHROPIC_MODEL_CHOICES,
  OPENAI_MODEL_CHOICES,
} from "@/lib/modelCatalog";
import {
  isOpenRouterEnabledAsync,
  parsePlatformProvider,
} from "@/lib/llm";
import { listOpenRouterModels } from "@/lib/openaiCompat";
import { getSettings } from "@/lib/store";
import { createLogger } from "@/lib/logger";

const log = createLogger("agent.models");

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
 * OpenAI/Anthropic stay on the curated catalogue. OpenRouter is a test
 * gateway: when the key is present and not explicitly disabled, the live
 * openrouter.ai catalogue is fetched so the operator can trial any route.
 * Never exposes key material.
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
      try {
        const live = await listOpenRouterModels(openrouterKey);
        options.push(
          ...live.map((m) => ({
            ref: `openrouter/${m.id}`,
            provider: "openrouter" as const,
            model: m.id,
            label: m.display_name || m.id,
          })),
        );
      } catch (err) {
        // Key present but catalogue unreachable — still surface the admin
        // default so the picker is not empty for OpenRouter.
        log.warn("openrouter.models.list_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      const adminOrModel = defaultOpenRouterModel?.trim();
      if (
        adminOrModel &&
        !options.some((o) => o.provider === "openrouter" && o.model === adminOrModel)
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
      configured: options.length > 0,
    });
  } catch (err) {
    return handleError(err);
  }
}
