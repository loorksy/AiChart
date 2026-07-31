import { NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { DEFAULT_ANTHROPIC_MODEL } from "@/lib/anthropic";
import {
  ANTHROPIC_MODEL_CHOICES,
  OPENAI_MODEL_CHOICES,
} from "@/lib/modelCatalog";
import { getSettings } from "@/lib/store";

export interface AgentModelOption {
  /** "provider/model" — what the client stores as the preference. */
  ref: string;
  provider: "openai" | "anthropic";
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
 * among the committed models. Never exposes key material.
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
