import { NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { DEFAULT_ANTHROPIC_MODEL } from "@/lib/anthropic";
import { ANTHROPIC_MODEL_CHOICES, OPENAI_MODEL_CHOICES } from "@/lib/modelCatalog";
import { parsePlatformProvider } from "@/lib/llm";
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
 * OpenAI/Anthropic stay on the curated catalogue. Never exposes key material.
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
    const provider = parsePlatformProvider(defaultProvider);
    const platformDefault =
      provider === "anthropic"
        ? `anthropic/${defaultClaudeModel?.trim() || DEFAULT_ANTHROPIC_MODEL}`
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
