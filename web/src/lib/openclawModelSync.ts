import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import {
  getActiveModel,
  getActiveProvider,
  getProviderApiKey,
  type LLMProvider,
} from "./llm";

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

export function modelRefFromPlatform(model?: string): string {
  const provider = getActiveProvider();
  const id = (model ?? getActiveModel()).trim();
  return id.startsWith(`${provider}/`) ? id : `${provider}/${id}`;
}

/** Provider base URLs OpenClaw needs for OpenAI-compatible providers. */
const PROVIDER_BASE_URL: Partial<Record<LLMProvider, string>> = {
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
};

/** Cheap-model fallback candidates per provider (used when its key is set). */
const FALLBACK_CANDIDATES: Record<LLMProvider, string> = {
  anthropic: "anthropic/claude-haiku-4-5",
  openrouter: "openrouter/anthropic/claude-haiku-4.5",
  openai: "openai/gpt-4.1-mini",
};

/** Fallback refs across all providers whose API keys are configured. */
export function buildFallbackRefs(primaryRef: string): string[] {
  const out: string[] = [];
  for (const provider of ["anthropic", "openrouter", "openai"] as const) {
    if (!getProviderApiKey(provider)) continue;
    const candidate = FALLBACK_CANDIDATES[provider];
    if (candidate.toLowerCase() === primaryRef.toLowerCase()) continue;
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
      model?: { primary?: string; fallbacks?: string[]; thinking?: unknown };
      models?: Record<
        string,
        { params?: { cacheRetention?: string; thinking?: string } }
      >;
    };
  };
  models?: {
    providers?: Record<string, ProviderBucket>;
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
  // gateway config (Anthropic reads its own env key).
  if (provider === "openrouter" || provider === "openai") {
    const apiKey = getProviderApiKey(provider);
    if (apiKey) merged.apiKey = apiKey;
    const baseUrl = PROVIDER_BASE_URL[provider];
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

  const fallbacks = buildFallbackRefs(ref);
  const model = d.model;
  d.model =
    model && typeof model === "object"
      ? { ...model, primary: ref, fallbacks }
      : { primary: ref, fallbacks };
  if (d.model && typeof d.model === "object") {
    delete (d.model as { thinking?: unknown }).thinking;
  }

  d.thinkingDefault = "off";
  d.models ??= {};
  const entry = d.models[ref] ?? {};
  d.models[ref] = {
    ...entry,
    params: {
      ...(entry.params ?? {}),
      cacheRetention: "long",
      thinking: "off",
    },
  };

  next = ensureProviderModelRegistered(next, ref);
  for (const fb of fallbacks) {
    next = ensureProviderModelRegistered(next, fb);
  }
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
  platformModel: string;
  platformRef: string;
  gatewayPrimary: string | null;
  gatewayConfigReadable: boolean;
  providerRegistered: boolean;
  inSync: boolean;
  thinkingDefault: string | null;
};

export function getAgentModelStatus(): AgentModelStatus {
  const platformModel = getActiveModel();
  const platformRef = modelRefFromPlatform(platformModel);
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
  error?: string;
};

/** Sync platform model → openclaw.json; pm2 restart when OPENCLAW_AUTO_RESTART=1. */
export async function syncOpenClawModelFromPlatform(
  model?: string,
): Promise<SyncResult> {
  const ref = modelRefFromPlatform(model);
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
