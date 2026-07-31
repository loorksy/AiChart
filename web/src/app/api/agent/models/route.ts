import { NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { listOpenAIChatModels } from "@/lib/openaiCompat";
import { ANTHROPIC_MODEL_CHOICES, DEFAULT_ANTHROPIC_MODEL } from "@/lib/anthropic";
import { getSettings } from "@/lib/store";
import { createLogger } from "@/lib/logger";

const log = createLogger("agent.models");

export interface AgentModelOption {
  /** "provider/model" — what the client stores as the preference. */
  ref: string;
  provider: "openai" | "anthropic";
  model: string;
  label: string;
}

/** Cache the OpenAI catalogue briefly — it changes rarely and the list is paged. */
let openaiCache: { at: number; models: AgentModelOption[] } | null = null;
const CACHE_MS = 10 * 60 * 1000;

/**
 * Models THIS user may pick from, for the chat composer's model selector.
 *
 * A provider appears only when the operator has configured its key: the admin
 * owns credentials, the user owns the choice. Never exposes key material.
 */
export async function GET() {
  try {
    const user = await requirePaidAccess();
    const [openaiKey, anthropicKey, defaultProvider, defaultOpenAiModel, defaultClaudeModel] =
      await Promise.all([
        getPlatformValueAsync("OPENAI_API_KEY"),
        getPlatformValueAsync("ANTHROPIC_API_KEY"),
        getPlatformValueAsync("AI_PROVIDER"),
        getPlatformValueAsync("AI_MODEL"),
        getPlatformValueAsync("ANTHROPIC_MODEL"),
      ]);

    const options: AgentModelOption[] = [];

    if (openaiKey) {
      if (openaiCache && Date.now() - openaiCache.at < CACHE_MS) {
        options.push(...openaiCache.models);
      } else {
        try {
          const models = await listOpenAIChatModels(openaiKey);
          const mapped: AgentModelOption[] = models.map((m) => ({
            ref: `openai/${m.id}`,
            provider: "openai" as const,
            model: m.id,
            label: m.id,
          }));
          openaiCache = { at: Date.now(), models: mapped };
          options.push(...mapped);
        } catch (error) {
          // A provider outage must not empty the picker for the other provider.
          log.warn("agent.models.openai_list_failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
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

    const settings = await getSettings(user.id);
    const platformDefault =
      defaultProvider?.trim() === "anthropic"
        ? `anthropic/${defaultClaudeModel?.trim() || DEFAULT_ANTHROPIC_MODEL}`
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
