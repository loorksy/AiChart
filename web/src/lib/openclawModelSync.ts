import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { GEMINI_OPENAI_BASE_URL, isGeminiStudioApiKey } from "./gemini";
import {
  getActiveModel,
  getActiveProvider,
  getProviderApiKey,
  type LLMProvider,
} from "./llm";
import { arabicBotCommands } from "./telegramCommands";

const execFileAsync = promisify(execFile);
const PM2_BIN = () => process.env.PM2_BIN?.trim() || "/usr/bin/pm2";
const PM2_ENV = () => ({
  ...process.env,
  PATH:
    process.env.PATH ||
    "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
});

export function openClawConfigPath(): string {
  return (
    process.env.OPENCLAW_CONFIG?.trim() ||
    path.join(process.env.HOME || "/root", ".openclaw", "openclaw.json")
  );
}

/** False when OPENCLAW_ENABLED=0 or openclaw.json is absent. */
export function isOpenClawEnabled(): boolean {
  const env = process.env.OPENCLAW_ENABLED?.trim().toLowerCase();
  if (env === "0" || env === "false" || env === "no") return false;
  if (env === "1" || env === "true" || env === "yes") return true;
  try {
    return fs.existsSync(openClawConfigPath());
  } catch {
    return false;
  }
}

export function modelRefFromPlatform(model?: string): string {
  const provider = getActiveProvider();
  const id = (model ?? getActiveModel()).trim();
  return id.startsWith(`${provider}/`) ? id : `${provider}/${id}`;
}

/** Provider base URLs OpenClaw needs for OpenAI-compatible providers. */
const PROVIDER_BASE_URL: Partial<Record<LLMProvider | "google", string>> = {
  openai: "https://api.openai.com/v1",
  google: GEMINI_OPENAI_BASE_URL,
};

/** Cheap cross-provider fallbacks (Anthropic excluded — OpenClaw needs OAuth, not API key in catalog). */
const CROSS_FALLBACK_CANDIDATES: Partial<Record<LLMProvider, string>> = {
  openai: "openai/gpt-4.1-mini",
  google: "google/gemini-2.5-flash",
};

/** Same-provider lighter model when primary hits rate limits. */
const SAME_PROVIDER_ALT: Partial<Record<LLMProvider, string>> = {
  google: "google/gemini-2.0-flash",
};

const FALLBACK_PROVIDER_ORDER: LLMProvider[] = ["openai", "google"];

const SYNC_PROVIDERS: LLMProvider[] = ["anthropic", "openai", "google"];

function isAllowedModelRef(ref: string): boolean {
  const lower = ref.toLowerCase();
  if (lower.includes("openrouter")) return false;
  if (lower.includes("-tts")) return false;
  const provider = providerKeyFromRef(ref);
  return SYNC_PROVIDERS.includes(provider as LLMProvider);
}

function providerKeyConfigured(provider: LLMProvider): boolean {
  const key = getProviderApiKey(provider);
  if (!key?.trim()) return false;
  if (provider === "google") return isGeminiStudioApiKey(key);
  return true;
}

/** Fallback refs across configured providers (never OpenRouter or Anthropic cross-fallback). */
export function buildFallbackRefs(primaryRef: string): string[] {
  const primaryProvider = providerKeyFromRef(primaryRef) as LLMProvider;
  const out: string[] = [];

  const sameAlt = SAME_PROVIDER_ALT[primaryProvider];
  if (
    sameAlt &&
    sameAlt.toLowerCase() !== primaryRef.toLowerCase() &&
    providerKeyConfigured(primaryProvider) &&
    isAllowedModelRef(sameAlt)
  ) {
    out.push(sameAlt);
  }

  for (const provider of FALLBACK_PROVIDER_ORDER) {
    if (provider === primaryProvider) continue;
    if (!providerKeyConfigured(provider)) continue;
    const candidate = CROSS_FALLBACK_CANDIDATES[provider];
    if (!candidate || !isAllowedModelRef(candidate)) continue;
    if (candidate.toLowerCase() === primaryRef.toLowerCase()) continue;
    if (out.some((r) => r.toLowerCase() === candidate.toLowerCase())) continue;
    out.push(candidate);
  }
  return out;
}

export function modelIdFromRef(ref: string): string {
  const slash = ref.indexOf("/");
  return slash >= 0 ? ref.slice(slash + 1) : ref;
}

export function providerKeyFromRef(ref: string): string {
  const slash = ref.indexOf("/");
  return slash >= 0 ? ref.slice(0, slash) : "anthropic";
}

type ProviderModelEntry = { id: string; name: string };
type ProviderBucket = {
  models?: ProviderModelEntry[];
  apiKey?: string;
  baseUrl?: string;
  api?: string;
};
type OpenClawCfg = {
  agents?: {
    defaults?: {
      thinking?: unknown;
      thinkingDefault?: string;
      heartbeat?: { isolatedSession?: boolean };
      contextPruning?: { mode?: string };
      model?: { primary?: string; fallbacks?: string[]; thinking?: unknown };
      models?: Record<
        string,
        {
          alias?: string;
          params?: {
            cacheRetention?: string;
            thinking?: string;
            maxTokens?: number;
          };
        }
      >;
    };
  };
  models?: {
    providers?: Record<string, ProviderBucket>;
  };
  channels?: {
    telegram?: {
      enabled?: boolean;
      botToken?: string;
      dmPolicy?: string;
      commands?: { native?: boolean; nativeSkills?: boolean };
      customCommands?: { command: string; description: string }[];
      capabilities?: { inlineButtons?: string };
    };
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function pm2(args: string[]): Promise<void> {
  await execFileAsync(PM2_BIN(), args, {
    timeout: 60_000,
    env: PM2_ENV(),
  });
}

export function isProviderModelRegistered(
  cfg: OpenClawCfg,
  ref: string,
): boolean {
  const provider = providerKeyFromRef(ref);
  const id = modelIdFromRef(ref);
  const models = cfg.models?.providers?.[provider]?.models ?? [];
  return models.some((m) => m.id === id);
}

/** Register runtime model in models.providers (required for new model ids). */
export function ensureProviderModelRegistered(
  cfg: OpenClawCfg,
  ref: string,
): OpenClawCfg {
  const provider = providerKeyFromRef(ref);
  const id = modelIdFromRef(ref);
  const next = { ...cfg };
  next.models ??= {};
  next.models.providers ??= {};
  const bucket = next.models.providers[provider] ?? { models: [] };
  const models = [...(bucket.models ?? [])];
  const idx = models.findIndex((m) => m.id === id);
  if (idx < 0) {
    models.push({ id, name: id });
  } else if (!models[idx].name) {
    models[idx] = { ...models[idx], name: id };
  }

  const merged: ProviderBucket = { ...bucket, models };
  // OpenAI-compatible providers need credentials + base URL inside the
  // gateway config (Anthropic reads API key from agent auth store).
  if (provider === "anthropic") {
    merged.api = merged.api || "anthropic-messages";
  } else if (provider === "openai" || provider === "google") {
    const keyProvider = provider as LLMProvider;
    const apiKey = getProviderApiKey(keyProvider);
    if (apiKey) merged.apiKey = apiKey;
    const baseUrl = PROVIDER_BASE_URL[keyProvider];
    if (baseUrl) {
      merged.baseUrl = baseUrl;
      merged.api = "openai-completions";
    }
  }
  next.models.providers[provider] = merged;
  return next;
}

export function readGatewayPrimaryModel(configPath?: string): string | null {
  const p = configPath ?? openClawConfigPath();
  if (!fs.existsSync(p)) return null;
  try {
    const cfg = JSON.parse(fs.readFileSync(p, "utf8")) as OpenClawCfg;
    const m = cfg.agents?.defaults?.model;
    if (typeof m === "string") return m;
    if (m && typeof m === "object" && typeof m.primary === "string") {
      return m.primary;
    }
    return null;
  } catch {
    return null;
  }
}

/** Keep only model ids referenced by primary + fallbacks in the catalog. */
function pruneModelCatalog(cfg: OpenClawCfg, activeRefs: string[]): void {
  const idsByProvider = new Map<string, Set<string>>();
  for (const full of activeRefs) {
    const provider = providerKeyFromRef(full);
    const id = modelIdFromRef(full);
    if (!idsByProvider.has(provider)) idsByProvider.set(provider, new Set());
    idsByProvider.get(provider)!.add(id);
  }

  cfg.models ??= {};
  cfg.models.providers ??= {};
  for (const [provider, allowed] of idsByProvider) {
    const bucket = cfg.models.providers[provider] ?? { models: [] };
    const models = [...allowed].map((id) => {
      const existing = (bucket.models ?? []).find((m) => m.id === id);
      return existing?.name ? existing : { id, name: id };
    });
    const merged: ProviderBucket = { ...bucket, models };
    if (provider === "anthropic") {
      merged.api = merged.api || "anthropic-messages";
    }
    cfg.models.providers[provider] = merged;
  }

  for (const provider of Object.keys(cfg.models.providers)) {
    if (!idsByProvider.has(provider)) {
      delete cfg.models.providers[provider];
    }
  }
}

/** Patch model, thinking, and provider registry — never touches telegram/exec/controlUi. */
export function patchOpenClawModelConfig(
  cfg: OpenClawCfg,
  ref: string,
): OpenClawCfg {
  let next = { ...cfg };
  next.agents ??= {};
  next.agents.defaults ??= {};

  const d = next.agents.defaults;
  delete d.thinking;

  const safeRef = isAllowedModelRef(ref)
    ? ref
    : modelRefFromPlatform(getActiveModel());
  const fallbacks = buildFallbackRefs(safeRef);
  const activeRefs = [safeRef, ...fallbacks];
  const model = d.model;
  d.model =
    model && typeof model === "object"
      ? { ...model, primary: safeRef, fallbacks }
      : { primary: safeRef, fallbacks };
  if (d.model && typeof d.model === "object") {
    delete (d.model as { thinking?: unknown }).thinking;
  }

  d.thinkingDefault = "off";
  delete d.contextPruning;
  delete d.heartbeat;
  const tokenParams = {
    cacheRetention: "long",
    thinking: "off",
    maxTokens: 16384,
  };
  d.models = {};
  for (const modelRef of activeRefs) {
    const entry: { alias?: string; params: typeof tokenParams } = {
      params: tokenParams,
    };
    if (modelRef === safeRef) {
      entry.alias = modelIdFromRef(safeRef);
    }
    d.models[modelRef] = entry;
  }

  next = ensureProviderModelRegistered(next, safeRef);
  for (const fb of fallbacks) {
    next = ensureProviderModelRegistered(next, fb);
  }
  pruneModelCatalog(next, activeRefs);
  return patchTelegramChannelConfig(next);
}

/** Arabic custom commands + disable native English slash menu. */
export function patchTelegramChannelConfig(cfg: OpenClawCfg): OpenClawCfg {
  const next = { ...cfg };
  const existing = next.channels?.telegram ?? {};
  next.channels = {
    ...next.channels,
    telegram: {
      ...existing,
      enabled: existing.enabled ?? true,
      dmPolicy: existing.dmPolicy ?? "open",
      commands: {
        native: false,
        nativeSkills: false,
      },
      customCommands: arabicBotCommands(),
      capabilities: {
        ...(existing.capabilities ?? {}),
        inlineButtons: existing.capabilities?.inlineButtons ?? "dm",
      },
    },
  };
  return next;
}

export function writeOpenClawModelSync(ref: string, configPath?: string): void {
  const p = configPath ?? openClawConfigPath();
  let cfg: OpenClawCfg = {};
  if (fs.existsSync(p)) {
    cfg = JSON.parse(fs.readFileSync(p, "utf8")) as OpenClawCfg;
  }
  const patched = patchOpenClawModelConfig(cfg, ref);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(patched, null, 2)}\n`, "utf8");
}

function loadConfig(configPath: string): OpenClawCfg | null {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8")) as OpenClawCfg;
  } catch {
    return null;
  }
}

export function isGatewayModelReady(
  ref: string,
  configPath?: string,
): boolean {
  const p = configPath ?? openClawConfigPath();
  const cfg = loadConfig(p);
  if (!cfg) return false;
  const primary = readGatewayPrimaryModel(p);
  if (!primary || primary.toLowerCase() !== ref.toLowerCase()) return false;
  return isProviderModelRegistered(cfg, ref);
}

export type AgentModelStatus = {
  openclawEnabled: boolean;
  platformModel: string;
  platformRef: string;
  gatewayPrimary: string | null;
  gatewayConfigReadable: boolean;
  providerRegistered: boolean;
  inSync: boolean;
  thinkingDefault: string | null;
};

export function getAgentModelStatus(): AgentModelStatus {
  const openclawEnabled = isOpenClawEnabled();
  const platformModel = getActiveModel();
  const platformRef = modelRefFromPlatform(platformModel);
  if (!openclawEnabled) {
    return {
      openclawEnabled: false,
      platformModel,
      platformRef,
      gatewayPrimary: null,
      gatewayConfigReadable: false,
      providerRegistered: false,
      inSync: true,
      thinkingDefault: null,
    };
  }
  const configPath = openClawConfigPath();
  const gatewayConfigReadable = fs.existsSync(configPath);
  const gatewayPrimary = readGatewayPrimaryModel(configPath);
  const cfg = gatewayConfigReadable ? loadConfig(configPath) : null;

  let thinkingDefault: string | null = null;
  if (cfg) {
    thinkingDefault =
      cfg.agents?.defaults?.thinkingDefault ??
      cfg.agents?.defaults?.models?.[platformRef]?.params?.thinking ??
      null;
  }

  const providerRegistered = cfg
    ? isProviderModelRegistered(cfg, platformRef)
    : false;

  const inSync =
    gatewayPrimary !== null &&
    gatewayPrimary.toLowerCase() === platformRef.toLowerCase() &&
    providerRegistered;

  return {
    openclawEnabled: true,
    platformModel,
    platformRef,
    gatewayPrimary,
    gatewayConfigReadable,
    providerRegistered,
    inSync,
    thinkingDefault,
  };
}

async function waitForAgentStopped(maxMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFileAsync(PM2_BIN(), ["jlist"], {
        timeout: 15_000,
        env: PM2_ENV(),
      });
      const list = JSON.parse(stdout) as Array<{
        name?: string;
        pm2_env?: { status?: string };
      }>;
      const app = list.find((a) => a.name === "aichart-agent");
      if (!app || app.pm2_env?.status === "stopped") return true;
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  return false;
}

async function isAgentOnline(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(PM2_BIN(), ["jlist"], {
      timeout: 15_000,
      env: PM2_ENV(),
    });
    const list = JSON.parse(stdout) as Array<{
      name?: string;
      pm2_env?: { status?: string };
    }>;
    const app = list.find((a) => a.name === "aichart-agent");
    return app?.pm2_env?.status === "online";
  } catch {
    return false;
  }
}

async function restartOpenClawAgent(): Promise<{ ok: boolean; error?: string }> {
  if (process.env.OPENCLAW_AUTO_RESTART !== "1") {
    return { ok: false, error: "OPENCLAW_AUTO_RESTART غير مفعّل" };
  }
  try {
    await pm2(["stop", "aichart-agent"]);
    const stopped = await waitForAgentStopped();
    if (!stopped) {
      return { ok: false, error: "تعذّر إيقاف aichart-agent قبل كتابة الإعدادات" };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `pm2 stop: ${msg}` };
  }
}

async function startOpenClawAgentAfterWrite(): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    await pm2(["restart", "aichart-agent", "--update-env"]);
    await sleep(5000);
    if (!(await isAgentOnline())) {
      return { ok: false, error: "aichart-agent لم يعد online بعد إعادة التشغيل" };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `pm2 restart: ${msg}` };
  }
}

export type SyncResult = {
  ok: boolean;
  ref: string;
  restarted: boolean;
  verified: boolean;
  providerRegistered: boolean;
  skipped?: boolean;
  error?: string;
};

/** Sync platform model → openclaw.json; pm2 restart when OPENCLAW_AUTO_RESTART=1. */
export async function syncOpenClawModelFromPlatform(
  model?: string,
): Promise<SyncResult> {
  const ref = modelRefFromPlatform(model);
  if (!isOpenClawEnabled()) {
    return {
      ok: true,
      ref,
      restarted: false,
      verified: false,
      providerRegistered: false,
      skipped: true,
    };
  }
  const configPath = openClawConfigPath();
  const autoRestart = process.env.OPENCLAW_AUTO_RESTART === "1";

  let restarted = false;
  let verified = false;
  let providerRegistered = false;

  try {
    if (autoRestart) {
      const stop = await restartOpenClawAgent();
      if (!stop.ok) {
        return {
          ok: false,
          ref,
          restarted: false,
          verified: false,
          providerRegistered: false,
          error: stop.error,
        };
      }
    }

    writeOpenClawModelSync(ref, configPath);
    providerRegistered = isGatewayModelReady(ref, configPath);

    if (!providerRegistered) {
      return {
        ok: false,
        ref,
        restarted: false,
        verified: false,
        providerRegistered: false,
        error: "فشل تسجيل النموذج في models.providers — راجع openclaw.json",
      };
    }

    if (autoRestart) {
      const start = await startOpenClawAgentAfterWrite();
      restarted = start.ok;
      verified = start.ok && isGatewayModelReady(ref, configPath);
      if (!start.ok) {
        return {
          ok: false,
          ref,
          restarted: false,
          verified: false,
          providerRegistered,
          error: start.error,
        };
      }
      if (!verified) {
        return {
          ok: false,
          ref,
          restarted: true,
          verified: false,
          providerRegistered,
          error:
            "أُعيد تشغيل Gateway لكن الإعدادات لم تُتحقق — شغّل: pm2 restart aichart-agent",
        };
      }
    }

    return {
      ok: true,
      ref,
      restarted,
      verified,
      providerRegistered,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn("[openclaw-model-sync]", error);
    return {
      ok: false,
      ref,
      restarted,
      verified,
      providerRegistered,
      error,
    };
  }
}
