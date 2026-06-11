import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { getAnthropicModel } from "./anthropic";

const execFileAsync = promisify(execFile);

export function openClawConfigPath(): string {
  return (
    process.env.OPENCLAW_CONFIG?.trim() ||
    path.join(process.env.HOME || "/root", ".openclaw", "openclaw.json")
  );
}

export function modelRefFromPlatform(model?: string): string {
  const id = (model ?? getAnthropicModel()).trim();
  return id.startsWith("anthropic/") ? id : `anthropic/${id}`;
}

type OpenClawCfg = {
  agents?: {
    defaults?: {
      thinking?: unknown;
      thinkingDefault?: string;
      model?: { primary?: string; thinking?: unknown };
      models?: Record<
        string,
        { params?: { cacheRetention?: string; thinking?: string } }
      >;
    };
  };
};

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

/** Patch only model + thinking — never touches telegram, exec, or controlUi. */
export function patchOpenClawModelConfig(
  cfg: OpenClawCfg,
  ref: string,
): OpenClawCfg {
  const next = { ...cfg };
  next.agents ??= {};
  next.agents.defaults ??= {};

  const d = next.agents.defaults;
  delete d.thinking;

  const model = d.model;
  d.model =
    model && typeof model === "object"
      ? { ...model, primary: ref }
      : { primary: ref };
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

export type AgentModelStatus = {
  platformModel: string;
  platformRef: string;
  gatewayPrimary: string | null;
  gatewayConfigReadable: boolean;
  inSync: boolean;
  thinkingDefault: string | null;
};

export function getAgentModelStatus(): AgentModelStatus {
  const platformModel = getAnthropicModel();
  const platformRef = modelRefFromPlatform(platformModel);
  const configPath = openClawConfigPath();
  const gatewayConfigReadable = fs.existsSync(configPath);
  const gatewayPrimary = readGatewayPrimaryModel(configPath);

  let thinkingDefault: string | null = null;
  if (gatewayConfigReadable) {
    try {
      const cfg = JSON.parse(
        fs.readFileSync(configPath, "utf8"),
      ) as OpenClawCfg;
      thinkingDefault =
        cfg.agents?.defaults?.thinkingDefault ??
        cfg.agents?.defaults?.models?.[platformRef]?.params?.thinking ??
        null;
    } catch {
      /* ignore */
    }
  }

  const inSync =
    gatewayPrimary !== null &&
    gatewayPrimary.toLowerCase() === platformRef.toLowerCase();

  return {
    platformModel,
    platformRef,
    gatewayPrimary,
    gatewayConfigReadable,
    inSync,
    thinkingDefault,
  };
}

async function stopOpenClawAgent(): Promise<void> {
  if (process.env.OPENCLAW_AUTO_RESTART !== "1") return;
  try {
    await execFileAsync("pm2", ["stop", "aichart-agent"], { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 3000));
  } catch (err) {
    console.warn("[openclaw-model-sync] pm2 stop failed:", err);
  }
}

async function startOpenClawAgent(): Promise<void> {
  if (process.env.OPENCLAW_AUTO_RESTART !== "1") return;
  try {
    await execFileAsync("pm2", ["start", "aichart-agent", "--update-env"], {
      timeout: 30_000,
    });
  } catch (err) {
    try {
      await execFileAsync("pm2", ["restart", "aichart-agent", "--update-env"], {
        timeout: 30_000,
      });
    } catch (retryErr) {
      console.warn("[openclaw-model-sync] pm2 start failed:", retryErr);
    }
  }
}

export type SyncResult = {
  ok: boolean;
  ref: string;
  restarted: boolean;
  error?: string;
};

/** Sync platform model → openclaw.json; optional pm2 restart on VPS. */
export async function syncOpenClawModelFromPlatform(
  model?: string,
): Promise<SyncResult> {
  const ref = modelRefFromPlatform(model);
  try {
    const restarted = process.env.OPENCLAW_AUTO_RESTART === "1";
    // Stop gateway before writing — shutdown can overwrite openclaw.json from memory.
    if (restarted) await stopOpenClawAgent();
    writeOpenClawModelSync(ref);
    if (restarted) await startOpenClawAgent();
    return { ok: true, ref, restarted };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn("[openclaw-model-sync]", error);
    return { ok: false, ref, restarted: false, error };
  }
}
