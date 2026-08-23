import { NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { ANTHROPIC_MODEL_CHOICES, OPENAI_MODEL_CHOICES } from "@/lib/modelCatalog";
import { getActiveProviderAsync, isProviderReadyAsync, resolveActiveSelection } from "@/lib/llm";
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
 * ONLY the operator's active provider is offered. Listing every provider
 * that happens to hold a key let a user pin their runs to a provider the
 * platform is not pointed at — the pick then failed against that provider's
 * billing while the rest of the platform ran fine elsewhere. The user picks
 * WHICH model answers; the operator picks WHOSE.
 */
export async function GET() {
  try {
    const user = await requirePaidAccess();
    const provider = await getActiveProviderAsync();
    const ready = await isProviderReadyAsync(provider);

    const options: AgentModelOption[] = [];
    if (ready) {
      const choices = provider === "anthropic" ? ANTHROPIC_MODEL_CHOICES : OPENAI_MODEL_CHOICES;
      options.push(
        ...choices.map((m) => ({
          ref: `${provider}/${m.id}`,
          provider,
          model: m.id,
          label: m.label,
        })),
      );
      // The admin's own configured model, when it sits outside the curated
      // list, is still a legitimate pick — it is what the platform runs by
      // default right now.
      const configuredField = provider === "anthropic" ? "ANTHROPIC_MODEL" : "AI_MODEL";
      const adminModel = (await getPlatformValueAsync(configuredField))?.trim();
      if (adminModel && !choices.some((m) => m.id === adminModel)) {
        options.push({
          ref: `${provider}/${adminModel}`,
          provider,
          model: adminModel,
          label: adminModel,
        });
      }
    }

    const settings = await getSettings(user.id);
    const active = await resolveActiveSelection("deep");
    const platformDefault = `${active.provider}/${active.model}`;
    // A preference left over from a previous provider is not "selected" any
    // more — the composer must show what will actually answer.
    const stored = settings.preferred_model_ref ?? null;
    const selected = stored && options.some((o) => o.ref === stored) ? stored : null;

    return NextResponse.json({
      models: options,
      selected,
      activeProvider: provider,
      platformDefault,
      configured: options.length > 0,
    });
  } catch (err) {
    return handleError(err);
  }
}
