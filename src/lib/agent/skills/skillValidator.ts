import type { AgentSkillMetadata, AgentSkillRiskLevel, AgentSkillTrust } from "./types";

const NAME = /^[a-z0-9][a-z0-9-]{1,63}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const RISKS = new Set<AgentSkillRiskLevel>(["read_only", "analysis", "recommendation", "execution"]);

function strings(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split(",").map((item) => item.trim()).filter(Boolean);
  return undefined;
}

export function validateSkillMetadata(
  raw: Record<string, unknown>,
  defaults: { trust: AgentSkillTrust; category?: string },
): { ok: true; metadata: AgentSkillMetadata } | { ok: false; error: string } {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const version = typeof raw.version === "string" ? raw.version.trim() : "1.0.0";
  if (!NAME.test(name)) return { ok: false, error: "name is required and must be lowercase kebab-case" };
  if (!description || description.length > 500) return { ok: false, error: "description is required and must be <= 500 characters" };
  if (!VERSION.test(version)) return { ok: false, error: "version must be semantic x.y.z" };
  const risk = typeof raw.riskLevel === "string" ? raw.riskLevel : "analysis";
  if (!RISKS.has(risk as AgentSkillRiskLevel)) return { ok: false, error: "invalid riskLevel" };
  const locales = strings(raw.supportedLocales)?.filter((value): value is "ar" | "en" => value === "ar" || value === "en");
  const requestedTrust = typeof raw.trust === "string" ? raw.trust : defaults.trust;
  // Frontmatter may lower trust but can never raise a user root to reviewed/system.
  const trust: AgentSkillTrust = defaults.trust === "user"
    ? "user"
    : requestedTrust === "user" ? "user" : defaults.trust;
  return {
    ok: true,
    metadata: {
      name,
      version,
      description,
      category: typeof raw.category === "string" && raw.category.trim() ? raw.category.trim() : defaults.category ?? "trading",
      enabled: raw.enabled !== false,
      trust,
      supportedLocales: locales?.length ? locales : undefined,
      allowedMarkets: strings(raw.allowedMarkets),
      requiredTools: strings(raw.requiredTools),
      forbiddenTools: strings(raw.forbiddenTools),
      riskLevel: risk as AgentSkillRiskLevel,
      tags: strings(raw.tags),
    },
  };
}
