import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { requireAdminWith } from "@/lib/adminRoles";
import { modelLooksLikeProvider } from "@/lib/modelCatalog";
import { providerLabel } from "@/lib/providerIdentity";
import { t } from "@/lib/i18n";
import {
  listPlatformConfigStatus,
  savePlatformConfig,
  PLATFORM_CONFIG_FIELDS,
} from "@/lib/platformConfig";
import { logAudit } from "@/lib/store";

const patchSchema = z.record(z.string(), z.union([z.string(), z.boolean()]).optional());

export async function GET() {
  try {
    await requireAdminWith("keys_write");
    return NextResponse.json({ fields: await listPlatformConfigStatus() });
  } catch (err) {
    return handleError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { admin } = await requireAdminWith("keys_write");
    const body = patchSchema.parse(await req.json());
    const allowed = new Set(PLATFORM_CONFIG_FIELDS.map((f) => f.key));
    const patch: Record<string, string | boolean | undefined> = {};
    for (const [key, value] of Object.entries(body)) {
      if (allowed.has(key)) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "لا توجد حقول صالحة للحفظ." }, { status: 400 });
    }

    // A model id is refused BY NAME the moment it is typed, if it does not
    // belong to the provider it is being saved for.
    //
    // Nothing infers a provider from a model's shape, so `ANTHROPIC_MODEL =
    // gpt-4.1` used to save cleanly and then fail at run time as a provider
    // error — which reads to the operator as "the AI account is broken" and
    // sends them to top up an account that was never the problem. The check
    // is by naming convention rather than the catalogue, so a genuinely new
    // model the repo has not listed yet still saves; only the cross-provider
    // mistake is refused.
    const MODEL_FIELD_PROVIDER: Record<string, "openai" | "anthropic"> = {
      ANTHROPIC_MODEL: "anthropic",
      ANTHROPIC_QUICK_MODEL: "anthropic",
      AI_MODEL: "openai",
      AI_QUICK_MODEL: "openai",
    };
    for (const [field, provider] of Object.entries(MODEL_FIELD_PROVIDER)) {
      const value = patch[field];
      if (typeof value !== "string" || !value.trim()) continue;
      if (!modelLooksLikeProvider(provider, value)) {
        return NextResponse.json(
          {
            error: t("ar", "config.model_wrong_provider", {
              model: value.trim(),
              field,
              provider: providerLabel(provider),
            }),
          },
          { status: 400 },
        );
      }
    }

    await savePlatformConfig(patch);
    await logAudit(admin.id, "platform_config", Object.keys(patch).join(", "));

    return NextResponse.json({
      ok: true,
      fields: await listPlatformConfigStatus(),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "بيانات غير صالحة." }, { status: 400 });
    }
    return handleError(err);
  }
}
