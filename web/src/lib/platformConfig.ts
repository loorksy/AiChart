import { getDb } from "./db";
import { encryptSecret, decryptSecret, maskKey } from "./crypto";

export interface ConfigFieldMeta {
  key: string;
  label: string;
  labelEn: string;
  group: "core" | "claude" | "telegram" | "ops";
  secret: boolean;
  /** Store plaintext in DB (bootstrap keys used to encrypt others) */
  plainStorage: boolean;
  placeholder?: string;
  type?: "text" | "url" | "toggle";
}

export const PLATFORM_CONFIG_FIELDS: ConfigFieldMeta[] = [
  {
    key: "ENCRYPTION_KEY",
    label: "مفتاح التشفير",
    labelEn: "ENCRYPTION_KEY",
    group: "core",
    secret: true,
    plainStorage: true,
    placeholder: "64 hex — openssl rand -hex 32",
  },
  {
    key: "APP_SECRET",
    label: "سر جلسات المستخدمين",
    labelEn: "APP_SECRET",
    group: "core",
    secret: true,
    plainStorage: true,
    placeholder: "سلسلة عشوائية طويلة",
  },
  {
    key: "ANTHROPIC_API_KEY",
    label: "مفتاح Claude (Anthropic)",
    labelEn: "ANTHROPIC_API_KEY",
    group: "claude",
    secret: true,
    plainStorage: false,
  },
  {
    key: "ANTHROPIC_MODEL",
    label: "نموذج Claude",
    labelEn: "ANTHROPIC_MODEL",
    group: "claude",
    secret: false,
    plainStorage: false,
    placeholder: "claude-3-5-sonnet-latest",
  },
  {
    key: "TELEGRAM_BOT_TOKEN",
    label: "توكن بوت تليجرام",
    labelEn: "TELEGRAM_BOT_TOKEN",
    group: "telegram",
    secret: true,
    plainStorage: false,
  },
  {
    key: "TELEGRAM_BOT_USERNAME",
    label: "اسم مستخدم البوت",
    labelEn: "TELEGRAM_BOT_USERNAME",
    group: "telegram",
    secret: false,
    plainStorage: false,
    placeholder: "بدون @",
  },
  {
    key: "TELEGRAM_WEBHOOK_SECRET",
    label: "سر Webhook تليجرام",
    labelEn: "TELEGRAM_WEBHOOK_SECRET",
    group: "telegram",
    secret: true,
    plainStorage: false,
  },
  {
    key: "CRON_SECRET",
    label: "سر مهام Cron / المراقبة",
    labelEn: "CRON_SECRET",
    group: "ops",
    secret: true,
    plainStorage: false,
  },
  {
    key: "APP_URL",
    label: "رابط الموقع العام",
    labelEn: "APP_URL",
    group: "ops",
    secret: false,
    plainStorage: false,
    type: "url",
    placeholder: "https://your-domain.com",
  },
  {
    key: "ENABLE_BINANCE_CLI",
    label: "تفعيل Binance CLI (قراءة فقط)",
    labelEn: "ENABLE_BINANCE_CLI",
    group: "ops",
    secret: false,
    plainStorage: false,
    type: "toggle",
  },
];

const cache = new Map<string, string>();

export function clearPlatformConfigCache(): void {
  cache.clear();
}

function readDbRaw(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value, plain FROM platform_config WHERE key = ?")
    .get(key) as { value: string; plain: number } | undefined;
  if (!row?.value) return null;
  if (row.plain) return row.value;
  try {
    return decryptSecret(row.value);
  } catch {
    // Legacy rows: non-secret values were stored plaintext with plain=0.
    const meta = PLATFORM_CONFIG_FIELDS.find((f) => f.key === key);
    if (meta && !meta.secret) return row.value;
    return null;
  }
}

function readEnv(key: string): string | undefined {
  const v = process.env[key];
  return v && v.length > 0 ? v : undefined;
}

/** Resolved value: cache → DB → process.env */
export function getPlatformValue(key: string): string | undefined {
  if (cache.has(key)) return cache.get(key);

  const fromDb = readDbRaw(key);
  if (fromDb) {
    cache.set(key, fromDb);
    return fromDb;
  }

  const fromEnv = readEnv(key);
  if (fromEnv) {
    cache.set(key, fromEnv);
    return fromEnv;
  }

  return undefined;
}

export interface ConfigStatusItem {
  key: string;
  label: string;
  labelEn: string;
  group: ConfigFieldMeta["group"];
  type?: ConfigFieldMeta["type"];
  placeholder?: string;
  configured: boolean;
  source: "db" | "env" | null;
  masked?: string;
  value?: string;
}

export function listPlatformConfigStatus(): ConfigStatusItem[] {
  return PLATFORM_CONFIG_FIELDS.map((f) => {
    const fromDb = readDbRaw(f.key);
    const fromEnv = readEnv(f.key);
    const value = fromDb ?? fromEnv;
    const configured = Boolean(value);
    const source = fromDb ? "db" : fromEnv ? "env" : null;

    return {
      key: f.key,
      label: f.label,
      labelEn: f.labelEn,
      group: f.group,
      type: f.type,
      placeholder: f.placeholder,
      configured,
      source,
      secret: f.secret,
      masked: value && f.secret ? maskKey(value) : undefined,
      value: value && !f.secret ? value : undefined,
    };
  });
}

export function savePlatformConfig(
  patch: Record<string, string | boolean | undefined>,
): void {
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO platform_config (key, value, plain, updated_at)
     VALUES (@key, @value, @plain, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       plain = excluded.plain,
       updated_at = datetime('now')`,
  );

  const run = db.transaction(() => {
    for (const field of PLATFORM_CONFIG_FIELDS) {
      if (!(field.key in patch)) continue;
      const raw = patch[field.key];
      if (raw === undefined || raw === "") {
        db.prepare("DELETE FROM platform_config WHERE key = ?").run(field.key);
        cache.delete(field.key);
        continue;
      }

      let stored: string;
      if (field.type === "toggle") {
        stored = raw === true || raw === "1" || raw === "true" ? "1" : "0";
      } else {
        stored = String(raw).trim();
      }

      const encrypt = field.secret && !field.plainStorage;
      const plain = encrypt ? 0 : 1;
      const value = encrypt ? encryptSecret(stored) : stored;

      upsert.run({ key: field.key, value, plain });
      cache.set(field.key, stored);
    }
  });

  run();
  clearPlatformConfigCache();
}
