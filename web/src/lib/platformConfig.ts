import { decryptSecret, encryptSecret, maskKey } from "./crypto";
import { initDb, loadPlatformConfigRows, queryOne, transaction } from "./db";

export interface ConfigFieldMeta {
  key: string;
  label: string;
  labelEn: string;
  group: "core" | "ai" | "telegram" | "ops";
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
    key: "AI_MODEL",
    label: "نموذج OpenAI",
    labelEn: "AI_MODEL",
    group: "ai",
    secret: false,
    plainStorage: false,
    placeholder: "gpt-4.1",
  },
  {
    key: "OPENAI_REALTIME_MODEL",
    label: "نموذج المحادثة الصوتية (Realtime)",
    labelEn: "OPENAI_REALTIME_MODEL",
    group: "ai",
    secret: false,
    plainStorage: false,
    placeholder: "gpt-realtime",
  },
  {
    key: "OPENAI_API_KEY",
    label: "مفتاح OpenAI",
    labelEn: "OPENAI_API_KEY",
    group: "ai",
    secret: true,
    plainStorage: false,
  },
  {
    key: "AI_PROVIDER",
    label: "مزوّد الذكاء الاصطناعي النشط",
    labelEn: "AI_PROVIDER",
    group: "ai",
    secret: false,
    plainStorage: false,
    placeholder: "openai | anthropic",
  },
  {
    key: "ANTHROPIC_API_KEY",
    label: "مفتاح Anthropic (Claude)",
    labelEn: "ANTHROPIC_API_KEY",
    group: "ai",
    secret: true,
    plainStorage: false,
  },
  {
    key: "ANTHROPIC_MODEL",
    label: "نموذج Claude",
    labelEn: "ANTHROPIC_MODEL",
    group: "ai",
    secret: false,
    plainStorage: false,
    placeholder: "claude-opus-5",
  },
  {
    key: "VOICE_RESPONSES_ENABLED",
    label: "تفعيل الردود الصوتية (OpenAI TTS)",
    labelEn: "VOICE_RESPONSES_ENABLED",
    group: "ops",
    secret: false,
    plainStorage: false,
    type: "toggle",
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
    key: "CRON_SECRET",
    label: "سر مهام Cron / المراقبة",
    labelEn: "CRON_SECRET",
    group: "ops",
    secret: true,
    plainStorage: false,
  },
  {
    // V2-A4: Google Sign-In — paste the OAuth client and flip the toggle.
    key: "GOOGLE_AUTH_ENABLED",
    label: "تفعيل تسجيل الدخول عبر Google",
    labelEn: "GOOGLE_AUTH_ENABLED",
    group: "ops",
    secret: false,
    plainStorage: false,
    type: "toggle",
  },
  {
    key: "GOOGLE_OAUTH_CLIENT_ID",
    label: "معرّف عميل Google OAuth",
    labelEn: "GOOGLE_OAUTH_CLIENT_ID",
    group: "ops",
    secret: false,
    plainStorage: false,
    placeholder: "xxxx.apps.googleusercontent.com",
  },
  {
    key: "GOOGLE_OAUTH_CLIENT_SECRET",
    label: "سر عميل Google OAuth",
    labelEn: "GOOGLE_OAUTH_CLIENT_SECRET",
    group: "ops",
    secret: true,
    plainStorage: false,
    placeholder: "GOCSPX-...",
  },
  {
    // V2-A3: Stripe goes live the moment these are pasted — no deploy needed.
    key: "STRIPE_SECRET_KEY",
    label: "مفتاح Stripe السري",
    labelEn: "STRIPE_SECRET_KEY",
    group: "ops",
    secret: true,
    plainStorage: false,
    placeholder: "sk_live_...",
  },
  {
    key: "STRIPE_WEBHOOK_SECRET",
    label: "سر Stripe Webhook",
    labelEn: "STRIPE_WEBHOOK_SECRET",
    group: "ops",
    secret: true,
    plainStorage: false,
    placeholder: "whsec_...",
  },
  {
    key: "STRIPE_PUBLISHABLE_KEY",
    label: "مفتاح Stripe المعلن",
    labelEn: "STRIPE_PUBLISHABLE_KEY",
    group: "ops",
    secret: false,
    plainStorage: false,
    placeholder: "pk_live_...",
  },
  {
    // V2-A2: master switch for credits enforcement. Off = today's behavior.
    key: "BILLING_ENFORCED",
    label: "تفعيل فرض الرصيد والباقات",
    labelEn: "BILLING_ENFORCED",
    group: "ops",
    secret: false,
    plainStorage: false,
    type: "toggle",
  },
  {
    // V2-A2: one-time trial credit (retail USD) for accounts with no subscription.
    key: "TRIAL_CREDIT_USD",
    label: "رصيد التجربة المجاني (دولار)",
    labelEn: "TRIAL_CREDIT_USD",
    group: "ops",
    secret: false,
    plainStorage: false,
    placeholder: "3",
  },
  {
    // V2-A1: retail multiplier over provider cost for credits burn. Lives in
    // the DB so the platform's margin never appears in this public repo.
    key: "BILLING_RETAIL_MULTIPLIER",
    label: "معامل تسعير الاستهلاك (تجزئة ÷ تكلفة)",
    labelEn: "BILLING_RETAIL_MULTIPLIER",
    group: "ops",
    secret: false,
    plainStorage: false,
    placeholder: "1.0",
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
];

const cache = new Map<string, string>();
const rawCache = new Map<string, { value: string; plain: number }>();

export function clearPlatformConfigCache(): void {
  cache.clear();
  rawCache.clear();
}

function populateFromRows(
  rows: { key: string; value: string; plain: number }[],
): void {
  for (const row of rows) {
    rawCache.set(row.key, { value: row.value, plain: row.plain });
    const decoded = decodeRaw(row.key, row.value, row.plain);
    if (decoded) cache.set(row.key, decoded);
  }
}

/** Called from initDb to avoid circular initDb calls. */
export async function refreshPlatformConfigCacheInternal(
  loader: () => Promise<{ key: string; value: string; plain: number }[]>,
): Promise<void> {
  clearPlatformConfigCache();
  populateFromRows(await loader());
}

export async function refreshPlatformConfigCache(): Promise<void> {
  await initDb();
  clearPlatformConfigCache();
  populateFromRows(await loadPlatformConfigRows());
}

function decodeRaw(key: string, value: string, plain: number): string | null {
  if (!value) return null;
  if (plain) return value;
  try {
    return decryptSecret(value);
  } catch {
    const meta = PLATFORM_CONFIG_FIELDS.find((f) => f.key === key);
    if (meta && !meta.secret) return value;
    return null;
  }
}

async function readDbRaw(key: string): Promise<string | null> {
  if (rawCache.size === 0) await refreshPlatformConfigCache();
  const row = rawCache.get(key);
  if (!row?.value) {
    const fromDb = await queryOne<{ value: string; plain: number }>(
      "SELECT value, plain FROM platform_config WHERE key = ?",
      [key],
    );
    if (!fromDb?.value) return null;
    rawCache.set(key, fromDb);
    return decodeRaw(key, fromDb.value, fromDb.plain);
  }
  return decodeRaw(key, row.value, row.plain);
}

function readEnv(key: string): string | undefined {
  const v = process.env[key];
  return v && v.length > 0 ? v : undefined;
}

/** Resolved value: cache → DB → process.env */
export function getPlatformValue(key: string): string | undefined {
  if (cache.has(key)) return cache.get(key);

  const fromEnv = readEnv(key);
  if (fromEnv) {
    cache.set(key, fromEnv);
    return fromEnv;
  }

  return undefined;
}

/** Async variant that loads from DB when cache miss. */
export async function getPlatformValueAsync(
  key: string,
): Promise<string | undefined> {
  if (cache.has(key)) return cache.get(key);
  const fromDb = await readDbRaw(key);
  if (fromDb) {
    cache.set(key, fromDb);
    return fromDb;
  }
  return getPlatformValue(key);
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
  secret?: boolean;
}

export async function listPlatformConfigStatus(): Promise<ConfigStatusItem[]> {
  await refreshPlatformConfigCache();
  return PLATFORM_CONFIG_FIELDS.map((f) => {
    const fromDb = rawCache.has(f.key)
      ? decodeRaw(f.key, rawCache.get(f.key)!.value, rawCache.get(f.key)!.plain)
      : null;
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

export async function savePlatformConfig(
  patch: Record<string, string | boolean | undefined>,
): Promise<void> {
  await transaction(async ({ execute: txExecute }) => {
    for (const field of PLATFORM_CONFIG_FIELDS) {
      if (!(field.key in patch)) continue;
      const raw = patch[field.key];
      if (raw === undefined || raw === "") {
        await txExecute("DELETE FROM platform_config WHERE key = ?", [
          field.key,
        ]);
        cache.delete(field.key);
        rawCache.delete(field.key);
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

      await txExecute(
        `INSERT INTO platform_config (key, value, plain, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           plain = excluded.plain,
           updated_at = datetime('now')`,
        [field.key, value, plain],
      );
      cache.set(field.key, stored);
      rawCache.set(field.key, { value, plain });
    }
  });

  clearPlatformConfigCache();
  await refreshPlatformConfigCache();
}
