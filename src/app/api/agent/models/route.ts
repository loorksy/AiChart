import { NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { DEFAULT_ANTHROPIC_MODEL } from "@/lib/anthropic";
import {
  ANTHROPIC_MODEL_CHOICES,
  DEFAULT_TOKENROUTER_MODEL,
  OPENAI_MODEL_CHOICES,
  tokenRouterModelLabel,
  tokenRouterOfferedModel,
} from "@/lib/modelCatalog";
import {
  isOpenRouterEnabledAsync,
  isTokenRouterEnabledAsync,
  parsePlatformProvider,
} from "@/lib/llm";
import { listOpenRouterFreeModels } from "@/lib/openaiCompat";
import { getSettings } from "@/lib/store";
import { createLogger } from "@/lib/logger";

const log = createLogger("agent.models");

export interface AgentModelOption {
  /** "provider/model" — what the client stores as the preference. */
  ref: string;
  provider: "openai" | "anthropic" | "openrouter" | "tokenrouter";
  model: string;
  label: string;
}

/**
 * Models THIS user may pick from, for the chat composer's model selector.
 *
 * OpenAI/Anthropic stay on the curated catalogue. OpenRouter is a test
 * gateway: when the key is present and not explicitly disabled, the live
 * openrouter.ai catalogue is fetched so the operator can trial any route.
 * TokenRouter offers the single route the admin set (TOKENROUTER_MODEL,
 * default DeepSeek V4 Pro) when the key is present and not disabled.
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
      tokenrouterKey,
      tokenrouterEnabled,
      defaultProvider,
      defaultOpenAiModel,
      defaultClaudeModel,
      defaultOpenRouterModel,
      defaultTokenRouterModel,
    ] = await Promise.all([
      getPlatformValueAsync("OPENAI_API_KEY"),
      getPlatformValueAsync("ANTHROPIC_API_KEY"),
      getPlatformValueAsync("OPENROUTER_API_KEY"),
      isOpenRouterEnabledAsync(),
      getPlatformValueAsync("TOKENROUTER_API_KEY"),
      isTokenRouterEnabledAsync(),
      getPlatformValueAsync("AI_PROVIDER"),
      getPlatformValueAsync("AI_MODEL"),
      getPlatformValueAsync("ANTHROPIC_MODEL"),
      getPlatformValueAsync("OPENROUTER_MODEL"),
      getPlatformValueAsync("TOKENROUTER_MODEL"),
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

    let firstFreeOpenRouterModel: string | null = null;
    if (openrouterKey && openrouterEnabled) {
      // FREE routes only, fetched live — the admin pastes a key and every
      // free model appears automatically; nobody curates OpenRouter by hand.
      try {
        const live = await listOpenRouterFreeModels(openrouterKey);
        // Same pick the engine's auto-resolution makes: the gateway's own
        // free auto-router when present, else the newest free route.
        firstFreeOpenRouterModel =
          live.find((m) => /^openrouter\/(free|auto)/i.test(m.id))?.id ??
          live[0]?.id ??
          null;
        options.push(
          ...live.map((m) => ({
            ref: `openrouter/${m.id}`,
            provider: "openrouter" as const,
            model: m.id,
            label: m.display_name || m.id,
          })),
        );
      } catch (err) {
        log.warn("openrouter.models.list_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const offeredTokenRouter = tokenRouterOfferedModel(defaultTokenRouterModel);
    if (tokenrouterKey && tokenrouterEnabled) {
      options.push({
        ref: `tokenrouter/${offeredTokenRouter}`,
        provider: "tokenrouter",
        model: offeredTokenRouter,
        label: tokenRouterModelLabel(offeredTokenRouter),
      });
    }

    const settings = await getSettings(user.id);
    const provider = parsePlatformProvider(defaultProvider);
    const platformDefault =
      provider === "anthropic"
        ? `anthropic/${defaultClaudeModel?.trim() || DEFAULT_ANTHROPIC_MODEL}`
        : provider === "openrouter"
          ? // Env override wins; otherwise the newest live free route — the
            // same pick the engine's auto-resolution makes.
            `openrouter/${defaultOpenRouterModel?.trim() || firstFreeOpenRouterModel || "openai/gpt-4o-mini"}`
          : provider === "tokenrouter"
            ? `tokenrouter/${offeredTokenRouter}`
            : `openai/${defaultOpenAiModel?.trim() || "gpt-4.1"}`;

    let selected = settings.preferred_model_ref ?? null;
    const selectedParsed = selected?.startsWith("tokenrouter/")
      ? selected
      : null;
    if (
      selectedParsed &&
      tokenrouterKey &&
      tokenrouterEnabled &&
      !options.some((o) => o.ref === selected)
    ) {
      selected = `tokenrouter/${offeredTokenRouter}`;
    }

    return NextResponse.json({
      models: options,
      selected,
      platformDefault,
      configured: options.length > 0,
    });
  } catch (err) {
    return handleError(err);
  }
}
