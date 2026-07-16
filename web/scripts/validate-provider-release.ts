import { canonicalIdentityCore } from "../src/lib/agent/canonicalIdentity";
import { voiceSystemInstructions } from "../src/lib/agent/voice/voiceIdentity";
import { getEaConnectionMeta } from "../src/lib/eaStore";
import { buildEaLiveQuotesSummary } from "../src/lib/eaLiveState";
import { openAICompatTokenLimitField } from "../src/lib/openaiCompat";
import { getPlatformValueAsync } from "../src/lib/platformConfig";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile();
} catch {
  // Production may inject configuration without a local .env file.
}

type ProviderName =
  | "openai"
  | "oanda"
  | "research"
  | "execution"
  | "telegram";

type ProbeState = "passed" | "failed" | "unconfigured";
type DetailValue = string | number | boolean | null;

interface ProbeResult {
  provider: ProviderName;
  branch: string;
  required: boolean;
  state: ProbeState;
  code: string;
  details: Record<string, DetailValue>;
}

type SafeOperation =
  | "openai.models"
  | "openai.generate"
  | "openai.tts"
  | "openai.realtime_secret"
  | "oanda.instruments"
  | "oanda.candles"
  | "oanda.pricing"
  | "research.live"
  | "research.ready"
  | "research.smoke_create"
  | "research.smoke_read"
  | "mt5.health"
  | "mt5.status"
  | "mt5.price"
  | "telegram.getMe"
  | "telegram.getWebhookInfo";

interface AllowedOperation {
  method: "GET" | "POST";
  path: RegExp;
  hosts?: readonly string[];
}

const OPERATIONS: Record<SafeOperation, AllowedOperation> = {
  "openai.models": {
    method: "GET",
    path: /^\/v1\/models$/,
    hosts: ["api.openai.com"],
  },
  "openai.generate": {
    method: "POST",
    path: /^\/v1\/chat\/completions$/,
    hosts: ["api.openai.com"],
  },
  "openai.tts": {
    method: "POST",
    path: /^\/v1\/audio\/speech$/,
    hosts: ["api.openai.com"],
  },
  "openai.realtime_secret": {
    method: "POST",
    path: /^\/v1\/realtime\/client_secrets$/,
    hosts: ["api.openai.com"],
  },
  "oanda.instruments": {
    method: "GET",
    path: /^\/v3\/accounts\/[^/]+\/instruments$/,
    hosts: ["api-fxpractice.oanda.com", "api-fxtrade.oanda.com"],
  },
  "oanda.candles": {
    method: "GET",
    path: /^\/v3\/instruments\/[^/]+\/candles$/,
    hosts: ["api-fxpractice.oanda.com", "api-fxtrade.oanda.com"],
  },
  "oanda.pricing": {
    method: "GET",
    path: /^\/v3\/accounts\/[^/]+\/pricing$/,
    hosts: ["api-fxpractice.oanda.com", "api-fxtrade.oanda.com"],
  },
  "research.live": { method: "GET", path: /^\/health\/live$/ },
  "research.ready": { method: "GET", path: /^\/health\/ready$/ },
  "research.smoke_create": {
    method: "POST",
    path: /^\/internal\/research\/jobs$/,
  },
  "research.smoke_read": {
    method: "GET",
    path: /^\/internal\/research\/jobs\/[A-Za-z0-9._:-]+$/,
  },
  "mt5.health": { method: "GET", path: /^\/health$/ },
  "mt5.status": { method: "GET", path: /^\/status$/ },
  "mt5.price": { method: "GET", path: /^\/price$/ },
  "telegram.getMe": {
    method: "GET",
    path: /^\/bot[^/]+\/getMe$/,
    hosts: ["api.telegram.org"],
  },
  "telegram.getWebhookInfo": {
    method: "GET",
    path: /^\/bot[^/]+\/getWebhookInfo$/,
    hosts: ["api.telegram.org"],
  },
};

const PROVIDERS: readonly ProviderName[] = [
  "openai",
  "oanda",
  "research",
  "execution",
  "telegram",
];

const DEFAULT_REQUIRED = new Set<ProviderName>([
  "openai",
  "oanda",
  "execution",
]);

const OPENAI_API = "https://api.openai.com";
const TELEGRAM_API = "https://api.telegram.org";
const DEFAULT_SYMBOL = "EURUSD";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_JSON_BYTES = 5 * 1024 * 1024;

class ProbeFailure extends Error {
  constructor(
    readonly code: string,
    readonly branch = "unknown",
  ) {
    super(code);
    this.name = "ProbeFailure";
  }
}

class ProbeUnconfigured extends ProbeFailure {
  constructor(code: string, branch: string) {
    super(code, branch);
    this.name = "ProbeUnconfigured";
  }
}

function fail(code: string, branch?: string): never {
  throw new ProbeFailure(code, branch);
}

function unconfigured(code: string, branch: string): never {
  throw new ProbeUnconfigured(code, branch);
}

function boundedEnvInt(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, Math.trunc(parsed)))
    : fallback;
}

function requestTimeoutMs(): number {
  return boundedEnvInt(
    "PROVIDER_RELEASE_TIMEOUT_MS",
    DEFAULT_TIMEOUT_MS,
    1_000,
    120_000,
  );
}

function isEnabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

async function configValue(name: string): Promise<string | undefined> {
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;
  try {
    return (await getPlatformValueAsync(name))?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function normalizeBaseUrl(raw: string, code: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fail(code);
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    fail(code);
  }
  return parsed.toString().replace(/\/$/, "");
}

function operationPolicyBody(
  operation: SafeOperation,
  body: unknown,
): void {
  if (operation !== "research.smoke_create") return;
  const record =
    body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : null;
  const payload =
    record?.payload && typeof record.payload === "object"
      ? (record.payload as Record<string, unknown>)
      : null;
  if (
    record?.job_type !== "service_smoke_test" ||
    record.max_retries !== 0 ||
    !payload ||
    payload.duration_ms !== 10 ||
    payload.steps !== 1
  ) {
    fail("research_smoke_policy_refused", "research");
  }
}

export function assertAllowedOperation(
  operation: SafeOperation,
  rawUrl: string,
  method: string,
  body?: unknown,
): void {
  const rule = OPERATIONS[operation];
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    fail("operation_url_invalid");
  }
  const normalizedMethod = method.toUpperCase();
  if (
    normalizedMethod !== rule.method ||
    !rule.path.test(url.pathname) ||
    (rule.hosts && !rule.hosts.includes(url.hostname))
  ) {
    fail("mutation_capable_operation_refused");
  }

  const forbiddenPath =
    /\/(?:orders?|trades?|commands?|close|cancel|connect|sendMessage|sendPhoto|sendVoice|deleteWebhook)(?:\/|$)/i;
  if (forbiddenPath.test(url.pathname)) {
    fail("mutation_capable_operation_refused");
  }
  operationPolicyBody(operation, body);
}

async function safeFetch(
  operation: SafeOperation,
  url: string,
  init: RequestInit = {},
  policyBody?: unknown,
): Promise<Response> {
  const method = String(init.method ?? "GET").toUpperCase();
  assertAllowedOperation(operation, url, method, policyBody);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs());
  try {
    return await fetch(url, {
      ...init,
      method,
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    fail(`${operation.replaceAll(".", "_")}_network_failed`);
  } finally {
    clearTimeout(timer);
  }
}

function requireStatus(
  response: Response,
  expected: readonly number[],
  code: string,
): void {
  if (!expected.includes(response.status)) {
    fail(`${code}_http_${response.status}`);
  }
}

async function readJson<T>(response: Response, code: string): Promise<T> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_JSON_BYTES) {
    fail(`${code}_response_too_large`);
  }
  try {
    return (await response.json()) as T;
  } catch {
    fail(`${code}_json_invalid`);
  }
}

function requiredProviders(): Set<ProviderName> {
  const raw = process.env.PROVIDER_RELEASE_REQUIRED?.trim();
  if (!raw) return new Set(DEFAULT_REQUIRED);
  if (raw.toLowerCase() === "none") return new Set();
  const parsed = new Set<ProviderName>();
  for (const item of raw.split(",")) {
    const provider = item.trim().toLowerCase();
    if (!PROVIDERS.includes(provider as ProviderName)) {
      fail("required_provider_invalid", "validator");
    }
    parsed.add(provider as ProviderName);
  }
  return parsed;
}

function normalizeOpenAIModel(raw: string): string {
  const model = raw.trim();
  if (model.startsWith("openai/")) return model.slice("openai/".length);
  if (model.includes("/")) fail("openai_model_provider_invalid", model);
  if (!/^[A-Za-z0-9._:-]+$/.test(model)) {
    fail("openai_model_invalid", "openai");
  }
  return model;
}

function openAIReasoningBody(model: string): Record<string, unknown> {
  const normalized = model.toLowerCase();
  return /^o\d/.test(normalized) || normalized.startsWith("gpt-5")
    ? { reasoning_effort: "low" }
    : {};
}

async function openAIGeneration(
  apiKey: string,
  model: string,
  locale: "en" | "ar",
): Promise<void> {
  const expected = locale === "en" ? "READY" : "جاهز";
  const userPrompt =
    locale === "en"
      ? "Reply with exactly READY and nothing else."
      : "أجب بكلمة جاهز فقط، دون أي إضافة.";
  const system = [
    canonicalIdentityCore(),
    "",
    "This is a provider transport release check with no user data.",
    "Do not analyze a market, make a recommendation, mention an account, or call tools.",
    "Return only the exact fixed probe response requested by the final message.",
  ].join("\n");
  const tokenField = openAICompatTokenLimitField(model);
  const body = {
    model,
    [tokenField]: 128,
    ...openAIReasoningBody(model),
    store: false,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
  };
  const response = await safeFetch(
    "openai.generate",
    `${OPENAI_API}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    body,
  );
  requireStatus(response, [200], `openai_generate_${locale}`);
  const payload = await readJson<{
    choices?: Array<{
      message?: { content?: string | null; tool_calls?: unknown[] };
    }>;
  }>(response, `openai_generate_${locale}`);
  const message = payload.choices?.[0]?.message;
  const output = message?.content?.normalize("NFC").trim();
  if (
    !output ||
    output.length > 32 ||
    output !== expected ||
    (message?.tool_calls?.length ?? 0) > 0
  ) {
    fail(`openai_generate_${locale}_unexpected_output`, model);
  }
  // Deliberately do not return or log model output.
}

async function openAITts(apiKey: string): Promise<void> {
  const model = process.env.OPENAI_TTS_MODEL?.trim() || "tts-1";
  const voice =
    process.env.OPENAI_TTS_VOICE?.trim() ||
    process.env.OPENAI_REALTIME_VOICE?.trim() ||
    "alloy";
  const body = {
    model,
    voice,
    input: "AiChart release provider check.",
    response_format: "opus",
  };
  const response = await safeFetch(
    "openai.tts",
    `${OPENAI_API}/v1/audio/speech`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    body,
  );
  requireStatus(response, [200], "openai_tts");
  const bytes = await response.arrayBuffer();
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    bytes.byteLength < 64 ||
    (!contentType.startsWith("audio/") &&
      contentType !== "application/octet-stream")
  ) {
    fail("openai_tts_empty_or_invalid", model);
  }
}

async function openAIRealtimeSecret(
  apiKey: string,
  model: string,
): Promise<void> {
  const voice = process.env.OPENAI_REALTIME_VOICE?.trim() || "alloy";
  const body = {
    expires_after: { anchor: "created_at", seconds: 60 },
    session: {
      type: "realtime",
      model,
      instructions: voiceSystemInstructions("en"),
      audio: {
        input: {
          turn_detection: {
            type: "server_vad",
            create_response: false,
            interrupt_response: true,
          },
        },
        output: { voice },
      },
    },
  };
  const response = await safeFetch(
    "openai.realtime_secret",
    `${OPENAI_API}/v1/realtime/client_secrets`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    body,
  );
  requireStatus(response, [200], "openai_realtime_secret");
  const payload = await readJson<{
    value?: string;
    expires_at?: number;
    client_secret?: { value?: string; expires_at?: number };
  }>(response, "openai_realtime_secret");
  const secret = payload.value ?? payload.client_secret?.value;
  const expiry = payload.expires_at ?? payload.client_secret?.expires_at;
  if (!secret || secret.length < 16) {
    fail("openai_realtime_secret_empty", model);
  }
  if (expiry !== undefined && expiry * 1000 <= Date.now() + 15_000) {
    fail("openai_realtime_secret_expiry_invalid", model);
  }
  // The ephemeral credential is intentionally discarded and never printed.
}

async function probeOpenAI(): Promise<{
  branch: string;
  details: Record<string, DetailValue>;
}> {
  const apiKey = await configValue("OPENAI_API_KEY");
  const model = normalizeOpenAIModel(
    (await configValue("AI_MODEL")) || "gpt-4.1",
  );
  if (!apiKey) unconfigured("openai_not_configured", model);

  const modelsResponse = await safeFetch(
    "openai.models",
    `${OPENAI_API}/v1/models`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  requireStatus(modelsResponse, [200], "openai_models");
  const modelsPayload = await readJson<{ data?: Array<{ id?: string }> }>(
    modelsResponse,
    "openai_models",
  );
  const modelIds = new Set(
    (modelsPayload.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => Boolean(id)),
  );
  if (modelIds.size === 0) fail("openai_models_empty", model);
  if (!modelIds.has(model)) fail("openai_configured_model_unavailable", model);

  await openAIGeneration(apiKey, model, "en");
  await openAIGeneration(apiKey, model, "ar");

  const ttsConfigured = isEnabled(
    await configValue("VOICE_RESPONSES_ENABLED"),
  );
  if (ttsConfigured) await openAITts(apiKey);

  const realtimeModelRaw = await configValue("OPENAI_REALTIME_MODEL");
  const realtimeModel = realtimeModelRaw
    ? normalizeOpenAIModel(realtimeModelRaw)
    : null;
  if (realtimeModel) {
    if (!modelIds.has(realtimeModel)) {
      fail("openai_realtime_model_unavailable", realtimeModel);
    }
    await openAIRealtimeSecret(apiKey, realtimeModel);
  }

  return {
    branch: model,
    details: {
      modelListReachable: true,
      modelCount: modelIds.size,
      configuredModelAvailable: true,
      englishGenerationVerified: true,
      arabicGenerationVerified: true,
      toolsSupplied: false,
      modelOutputLogged: false,
      tts: ttsConfigured ? "passed" : "unconfigured",
      realtime: realtimeModel ? "passed" : "unconfigured",
      ephemeralCredentialLogged: false,
    },
  };
}

function canonicalForexSymbol(raw: string): string {
  const normalized = raw.toUpperCase().replace(/[^A-Z]/g, "");
  if (!/^[A-Z]{6}$/.test(normalized)) {
    fail("probe_symbol_invalid", "market-data");
  }
  return normalized;
}

function oandaInstrument(symbol: string): string {
  return `${symbol.slice(0, 3)}_${symbol.slice(3)}`;
}

function forexMarketOpen(now = new Date()): boolean {
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  return !(
    day === 6 ||
    (day === 0 && hour < 22) ||
    (day === 5 && hour >= 22)
  );
}

function assertFinitePositive(
  value: unknown,
  code: string,
  branch: string,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) fail(code, branch);
  return parsed;
}

function assertFreshIso(
  value: unknown,
  code: string,
  branch: string,
): number {
  if (typeof value !== "string") fail(code, branch);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) fail(code, branch);
  const ageMs = Date.now() - timestamp;
  const openMaximum = boundedEnvInt(
    "PROVIDER_RELEASE_MARKET_MAX_AGE_MS",
    15 * 60_000,
    10_000,
    24 * 60 * 60_000,
  );
  const closedMaximum = boundedEnvInt(
    "PROVIDER_RELEASE_CLOSED_MARKET_MAX_AGE_MS",
    72 * 60 * 60_000,
    60_000,
    7 * 24 * 60 * 60_000,
  );
  const maximum = forexMarketOpen() ? openMaximum : closedMaximum;
  if (ageMs < -120_000 || ageMs > maximum) fail(code, branch);
  return ageMs;
}

async function probeOanda(): Promise<{
  branch: string;
  details: Record<string, DetailValue>;
}> {
  const apiToken = await configValue("OANDA_API_TOKEN");
  const accountId = await configValue("OANDA_ACCOUNT_ID");
  const environment = (
    (await configValue("OANDA_ENV")) || "practice"
  ).toLowerCase();
  if (!apiToken && !accountId) {
    unconfigured("oanda_not_configured", environment);
  }
  if (!apiToken || !accountId) {
    fail("oanda_configuration_incomplete", environment);
  }
  if (environment !== "practice" && environment !== "live") {
    fail("oanda_environment_invalid", environment);
  }

  const symbol = canonicalForexSymbol(
    process.env.PROVIDER_RELEASE_OANDA_SYMBOL?.trim() ||
      process.env.PROVIDER_RELEASE_SYMBOL?.trim() ||
      DEFAULT_SYMBOL,
  );
  const instrument = oandaInstrument(symbol);
  const base =
    environment === "live"
      ? "https://api-fxtrade.oanda.com"
      : "https://api-fxpractice.oanda.com";
  const headers = { Authorization: `Bearer ${apiToken}` };

  const instrumentsResponse = await safeFetch(
    "oanda.instruments",
    `${base}/v3/accounts/${encodeURIComponent(accountId)}/instruments`,
    { headers },
  );
  requireStatus(instrumentsResponse, [200], "oanda_instruments");
  const instrumentsPayload = await readJson<{
    instruments?: Array<{ name?: string }>;
  }>(instrumentsResponse, "oanda_instruments");
  const instruments = instrumentsPayload.instruments ?? [];
  if (!instruments.some((item) => item.name === instrument)) {
    fail("oanda_symbol_not_in_account", environment);
  }

  const candlesUrl = new URL(
    `${base}/v3/instruments/${encodeURIComponent(instrument)}/candles`,
  );
  candlesUrl.searchParams.set("granularity", "M1");
  candlesUrl.searchParams.set("count", "3");
  candlesUrl.searchParams.set("price", "M");
  const candlesResponse = await safeFetch(
    "oanda.candles",
    candlesUrl.toString(),
    { headers },
  );
  requireStatus(candlesResponse, [200], "oanda_candles");
  const candlesPayload = await readJson<{
    instrument?: string;
    candles?: Array<{
      time?: string;
      mid?: { o?: string; h?: string; l?: string; c?: string };
    }>;
  }>(candlesResponse, "oanda_candles");
  if (
    candlesPayload.instrument &&
    candlesPayload.instrument !== instrument
  ) {
    fail("oanda_candle_symbol_mismatch", environment);
  }
  const candles = candlesPayload.candles ?? [];
  if (candles.length === 0) fail("oanda_candles_empty", environment);
  let previousTime = -1;
  for (const candle of candles) {
    if (!candle.mid) fail("oanda_candle_mid_missing", environment);
    const time = Date.parse(candle.time ?? "");
    const open = assertFinitePositive(
      candle.mid.o,
      "oanda_candle_open_invalid",
      environment,
    );
    const high = assertFinitePositive(
      candle.mid.h,
      "oanda_candle_high_invalid",
      environment,
    );
    const low = assertFinitePositive(
      candle.mid.l,
      "oanda_candle_low_invalid",
      environment,
    );
    const close = assertFinitePositive(
      candle.mid.c,
      "oanda_candle_close_invalid",
      environment,
    );
    if (
      !Number.isFinite(time) ||
      time <= previousTime ||
      high < Math.max(open, low, close) ||
      low > Math.min(open, high, close)
    ) {
      fail("oanda_candle_shape_invalid", environment);
    }
    previousTime = time;
  }
  const candleAgeMs = assertFreshIso(
    candles.at(-1)?.time,
    "oanda_candles_stale",
    environment,
  );

  const pricingUrl = new URL(
    `${base}/v3/accounts/${encodeURIComponent(accountId)}/pricing`,
  );
  pricingUrl.searchParams.set("instruments", instrument);
  const pricingResponse = await safeFetch(
    "oanda.pricing",
    pricingUrl.toString(),
    { headers },
  );
  requireStatus(pricingResponse, [200], "oanda_pricing");
  const pricingPayload = await readJson<{
    prices?: Array<{
      instrument?: string;
      time?: string;
      bids?: Array<{ price?: string }>;
      asks?: Array<{ price?: string }>;
    }>;
  }>(pricingResponse, "oanda_pricing");
  const price = (pricingPayload.prices ?? []).find(
    (item) => item.instrument === instrument,
  );
  if (!price) fail("oanda_pricing_symbol_missing", environment);
  const bid = assertFinitePositive(
    price.bids?.[0]?.price,
    "oanda_bid_invalid",
    environment,
  );
  const ask = assertFinitePositive(
    price.asks?.[0]?.price,
    "oanda_ask_invalid",
    environment,
  );
  if (ask < bid) fail("oanda_spread_invalid", environment);
  const pricingAgeMs = assertFreshIso(
    price.time,
    "oanda_pricing_stale",
    environment,
  );

  return {
    branch: environment,
    details: {
      symbol,
      instrumentListed: true,
      candleCount: candles.length,
      candlesFinite: true,
      candlesOrdered: true,
      candleAgeMs,
      pricingSymbolVerified: true,
      pricingFinite: true,
      pricingAgeMs,
      marketOpen: forexMarketOpen(),
      methods: "GET-only",
    },
  };
}

function researchHeaders(
  token: string,
  userId?: number,
  requestId?: string,
  idempotencyKey?: string,
): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-AiChart-Caller": "aichart-provider-release",
    ...(userId ? { "X-AiChart-User-Id": String(userId) } : {}),
    ...(requestId ? { "X-AiChart-Request-Id": requestId } : {}),
    ...(idempotencyKey
      ? { "X-AiChart-Idempotency-Key": idempotencyKey }
      : {}),
  };
}

function stableResearchProbeId(): string {
  const commit = (process.env.GIT_COMMIT || "current")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 20);
  return `provider-release-${commit || "current"}-smoke-v1`;
}

async function runResearchSmoke(
  base: string,
  token: string,
): Promise<void> {
  if (!isEnabled(process.env.PROVIDER_RELEASE_RESEARCH_SCRATCH_ACK)) {
    fail("research_scratch_ack_required", "research");
  }
  const userId = Number(
    process.env.PROVIDER_RELEASE_RESEARCH_SCRATCH_USER_ID,
  );
  if (!Number.isInteger(userId) || userId <= 0) {
    fail("research_scratch_user_invalid", "research");
  }
  const probeId = stableResearchProbeId();
  const body = {
    job_type: "service_smoke_test",
    user_id: userId,
    request_id: probeId,
    idempotency_key: probeId,
    timeout_seconds: 10,
    max_retries: 0,
    payload: { duration_ms: 10, steps: 1 },
  };
  const headers = researchHeaders(token, userId, probeId, probeId);
  const createResponse = await safeFetch(
    "research.smoke_create",
    `${base}/internal/research/jobs`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
    body,
  );
  requireStatus(createResponse, [200, 202], "research_smoke_create");
  const created = await readJson<{
    job?: {
      job_id?: string;
      job_type?: string;
      user_id?: number;
      idempotency_key?: string;
      status?: string;
    };
  }>(createResponse, "research_smoke_create");
  const job = created.job;
  if (
    !job?.job_id ||
    !/^[A-Za-z0-9._:-]+$/.test(job.job_id) ||
    job.job_type !== "service_smoke_test" ||
    job.user_id !== userId ||
    job.idempotency_key !== probeId
  ) {
    fail("research_smoke_tenant_or_idempotency_invalid", "research");
  }

  const deadline = Date.now() + Math.min(requestTimeoutMs(), 30_000);
  let status = job.status;
  while (
    status &&
    !["succeeded", "failed", "cancelled", "timed_out"].includes(status) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const readResponse = await safeFetch(
      "research.smoke_read",
      `${base}/internal/research/jobs/${encodeURIComponent(job.job_id)}`,
      { headers: researchHeaders(token, userId, probeId) },
    );
    requireStatus(readResponse, [200], "research_smoke_read");
    const current = await readJson<{
      job_id?: string;
      job_type?: string;
      user_id?: number;
      idempotency_key?: string;
      status?: string;
    }>(readResponse, "research_smoke_read");
    if (
      current.job_id !== job.job_id ||
      current.job_type !== "service_smoke_test" ||
      current.user_id !== userId ||
      current.idempotency_key !== probeId
    ) {
      fail("research_smoke_read_scope_invalid", "research");
    }
    status = current.status;
  }
  if (status !== "succeeded") {
    fail("research_smoke_not_succeeded", "research");
  }
}

async function probeResearch(): Promise<{
  branch: string;
  details: Record<string, DetailValue>;
}> {
  const enabled = isEnabled(process.env.RESEARCH_SERVICE_ENABLED);
  const smokeRequested = isEnabled(
    process.env.PROVIDER_RELEASE_RESEARCH_SMOKE,
  );
  if (!enabled) {
    if (smokeRequested) fail("research_smoke_requested_while_disabled");
    unconfigured("research_service_disabled", "disabled");
  }
  const rawUrl = process.env.RESEARCH_SERVICE_URL?.trim();
  const token = process.env.RESEARCH_SERVICE_INTERNAL_TOKEN?.trim();
  if (!rawUrl || !token || token.length < 16) {
    fail("research_configuration_incomplete", "enabled");
  }
  const base = normalizeBaseUrl(rawUrl, "research_url_invalid");

  const liveResponse = await safeFetch(
    "research.live",
    `${base}/health/live`,
  );
  requireStatus(liveResponse, [200], "research_live");
  const live = await readJson<{ status?: string; service?: string }>(
    liveResponse,
    "research_live",
  );
  if (live.status !== "live" || live.service !== "aichart-research") {
    fail("research_live_payload_invalid", "enabled");
  }

  const readyResponse = await safeFetch(
    "research.ready",
    `${base}/health/ready`,
    { headers: researchHeaders(token) },
  );
  requireStatus(readyResponse, [200], "research_ready");
  const ready = await readJson<{
    status?: string;
    service?: string;
    storage?: string;
  }>(readyResponse, "research_ready");
  if (
    ready.status !== "ready" ||
    ready.service !== "aichart-research"
  ) {
    fail("research_ready_payload_invalid", "enabled");
  }

  if (smokeRequested) await runResearchSmoke(base, token);

  return {
    branch: "enabled",
    details: {
      liveness: true,
      readiness: true,
      storage: ready.storage || "unknown",
      scratchSmoke: smokeRequested ? "passed" : "not_requested",
      scratchSmokeIdempotent: smokeRequested,
      tenantScoped: smokeRequested,
      arbitraryJobsAllowed: false,
    },
  };
}

function executionBranch(): "ea" | "mt5local" | "metaapi" {
  const raw = (
    process.env.PROVIDER_RELEASE_EXECUTION_BRANCH ||
    process.env.FOREX_BACKEND ||
    ""
  )
    .trim()
    .toLowerCase();
  if (raw === "ea" || raw === "mt_ea") return "ea";
  if (["mt5local", "mt5_local", "local"].includes(raw)) {
    return "mt5local";
  }
  if (raw === "metaapi") return "metaapi";
  if (raw) fail("execution_branch_invalid", raw);
  return process.env.MT5_BRIDGE_URL?.trim() ? "mt5local" : "ea";
}

function matchingBrokerSymbol(candidate: string, canonical: string): boolean {
  const normalized = candidate.toUpperCase().replace(/[^A-Z]/g, "");
  return normalized.startsWith(canonical);
}

async function probeEa(): Promise<{
  branch: string;
  details: Record<string, DetailValue>;
}> {
  const userId = Number(
    process.env.PROVIDER_RELEASE_EA_USER_ID ||
      process.env.AICHART_AGENT_USER_ID,
  );
  if (!Number.isInteger(userId) || userId <= 0) {
    unconfigured("ea_probe_user_not_configured", "ea");
  }
  const symbol = canonicalForexSymbol(
    process.env.PROVIDER_RELEASE_EA_SYMBOL?.trim() ||
      process.env.PROVIDER_RELEASE_SYMBOL?.trim() ||
      DEFAULT_SYMBOL,
  );
  const connection = await getEaConnectionMeta(userId);
  if (!connection || connection.status === "revoked") {
    fail("ea_connection_missing_or_revoked", "ea");
  }
  const quotes = await buildEaLiveQuotesSummary(userId);
  const quote = quotes.quotes.find((item) =>
    matchingBrokerSymbol(item.symbol, symbol),
  );
  if (!quote) fail("ea_quote_symbol_missing", "ea");
  const bid = assertFinitePositive(quote.bid, "ea_bid_invalid", "ea");
  const ask = assertFinitePositive(quote.ask, "ea_ask_invalid", "ea");
  if (ask < bid) fail("ea_spread_invalid", "ea");
  const marketOpen = forexMarketOpen();
  if (
    marketOpen &&
    (!connection.online || !quote.isFresh || quote.tickStale === true)
  ) {
    fail("ea_not_ready_or_quote_stale", "ea");
  }

  return {
    branch: "ea",
    details: {
      symbol,
      connectionStatusRead: true,
      online: connection.online,
      quoteRead: true,
      quoteFinite: true,
      quoteFresh: quote.isFresh,
      tickStale: quote.tickStale ?? null,
      marketOpen,
      readiness: marketOpen ? "ready" : "market_closed",
      commandsRead: false,
      commandsEnqueued: false,
      tradesExecuted: false,
    },
  };
}

function mt5Query(
  base: string,
  path: "/status" | "/price",
  login: string,
  server?: string,
  symbol?: string,
): string {
  const url = new URL(`${base}${path}`);
  url.searchParams.set("login", login);
  if (server) url.searchParams.set("server", server);
  if (symbol) url.searchParams.set("symbol", symbol);
  return url.toString();
}

async function probeMt5(): Promise<{
  branch: string;
  details: Record<string, DetailValue>;
}> {
  const rawUrl = process.env.MT5_BRIDGE_URL?.trim();
  const token = process.env.MT5_BRIDGE_TOKEN?.trim();
  const login = process.env.PROVIDER_RELEASE_MT5_LOGIN?.trim();
  const server = process.env.PROVIDER_RELEASE_MT5_SERVER?.trim();
  if (!rawUrl && !token && !login) {
    unconfigured("mt5_not_configured", "mt5local");
  }
  if (!rawUrl || !token || !login || !/^\d{3,20}$/.test(login)) {
    fail("mt5_configuration_incomplete", "mt5local");
  }
  const base = normalizeBaseUrl(rawUrl, "mt5_url_invalid");
  const symbol = (
    process.env.PROVIDER_RELEASE_MT5_SYMBOL?.trim() ||
    process.env.PROVIDER_RELEASE_SYMBOL?.trim() ||
    DEFAULT_SYMBOL
  ).toUpperCase();
  if (!/^[A-Z0-9._-]{3,32}$/.test(symbol)) {
    fail("mt5_symbol_invalid", "mt5local");
  }
  const headers = {
    "X-Bridge-Token": token,
    "Content-Type": "application/json",
  };

  const healthResponse = await safeFetch(
    "mt5.health",
    `${base}/health`,
    { headers },
  );
  requireStatus(healthResponse, [200], "mt5_health");
  const health = await readJson<{
    ok?: boolean;
    initialized?: boolean;
  }>(healthResponse, "mt5_health");
  if (health.ok !== true || health.initialized !== true) {
    fail("mt5_health_not_ready", "mt5local");
  }

  const statusResponse = await safeFetch(
    "mt5.status",
    mt5Query(base, "/status", login, server),
    { headers },
  );
  requireStatus(statusResponse, [200], "mt5_status");
  const status = await readJson<{
    connected?: boolean;
    account?: { login?: string | number };
  }>(statusResponse, "mt5_status");
  if (
    status.connected !== true ||
    String(status.account?.login ?? "") !== login
  ) {
    fail("mt5_status_account_mismatch", "mt5local");
  }

  const priceResponse = await safeFetch(
    "mt5.price",
    mt5Query(base, "/price", login, server, symbol),
    { headers },
  );
  requireStatus(priceResponse, [200], "mt5_price");
  const price = await readJson<{
    symbol?: string;
    bid?: number;
    ask?: number;
    time?: number;
  }>(priceResponse, "mt5_price");
  if (price.symbol?.toUpperCase() !== symbol) {
    fail("mt5_price_symbol_mismatch", "mt5local");
  }
  const bid = assertFinitePositive(price.bid, "mt5_bid_invalid", "mt5local");
  const ask = assertFinitePositive(price.ask, "mt5_ask_invalid", "mt5local");
  if (ask < bid) fail("mt5_spread_invalid", "mt5local");
  const marketOpen = forexMarketOpen();
  if (marketOpen) {
    const tickTime = Number(price.time);
    const maxAgeMs = boundedEnvInt(
      "PROVIDER_RELEASE_MARKET_MAX_AGE_MS",
      15 * 60_000,
      10_000,
      24 * 60 * 60_000,
    );
    if (
      !Number.isFinite(tickTime) ||
      Date.now() - tickTime < -120_000 ||
      Date.now() - tickTime > maxAgeMs
    ) {
      fail("mt5_price_stale", "mt5local");
    }
  }

  return {
    branch: "mt5local",
    details: {
      symbol,
      healthRead: true,
      statusRead: true,
      accountMatchedWithoutLogging: true,
      quoteRead: true,
      quoteFinite: true,
      marketOpen,
      readiness: marketOpen ? "ready" : "market_closed",
      methods: "GET-only",
      commandsEnqueued: false,
      tradesExecuted: false,
    },
  };
}

async function probeExecution(): Promise<{
  branch: string;
  details: Record<string, DetailValue>;
}> {
  const branch = executionBranch();
  if (branch === "metaapi") {
    fail("metaapi_execution_branch_not_supported", branch);
  }
  return branch === "ea" ? probeEa() : probeMt5();
}

async function telegramGet(
  operation: "telegram.getMe" | "telegram.getWebhookInfo",
  token: string,
): Promise<unknown> {
  const method =
    operation === "telegram.getMe" ? "getMe" : "getWebhookInfo";
  const response = await safeFetch(
    operation,
    `${TELEGRAM_API}/bot${encodeURIComponent(token)}/${method}`,
  );
  requireStatus(response, [200], operation.replace(".", "_"));
  const payload = await readJson<{
    ok?: boolean;
    result?: unknown;
  }>(response, operation.replace(".", "_"));
  if (payload.ok !== true || !payload.result) {
    fail(`${operation.replaceAll(".", "_")}_payload_invalid`, "telegram");
  }
  return payload.result;
}

async function probeTelegram(): Promise<{
  branch: string;
  details: Record<string, DetailValue>;
}> {
  const token = await configValue("TELEGRAM_BOT_TOKEN");
  if (!token) unconfigured("telegram_not_configured", "bot-api");

  const identity = (await telegramGet(
    "telegram.getMe",
    token,
  )) as Record<string, unknown>;
  if (
    identity.is_bot !== true ||
    !Number.isFinite(Number(identity.id)) ||
    Number(identity.id) <= 0
  ) {
    fail("telegram_identity_invalid", "bot-api");
  }

  const webhook = (await telegramGet(
    "telegram.getWebhookInfo",
    token,
  )) as Record<string, unknown>;
  const pending = Number(webhook.pending_update_count ?? 0);
  if (!Number.isFinite(pending) || pending < 0) {
    fail("telegram_webhook_info_invalid", "bot-api");
  }

  return {
    branch: "bot-api",
    details: {
      botIdentityVerified: true,
      webhookInfoVerified: true,
      webhookConfigured: Boolean(webhook.url),
      pendingUpdateCount: pending,
      methods: "GET-only",
      messagesSent: false,
      webhookChanged: false,
    },
  };
}

async function captureProbe(
  provider: ProviderName,
  required: boolean,
  probe: () => Promise<{
    branch: string;
    details: Record<string, DetailValue>;
  }>,
): Promise<ProbeResult> {
  try {
    const result = await probe();
    return {
      provider,
      branch: result.branch,
      required,
      state: "passed",
      code: "ok",
      details: result.details,
    };
  } catch (error) {
    if (error instanceof ProbeUnconfigured) {
      return {
        provider,
        branch: error.branch,
        required,
        state: required ? "failed" : "unconfigured",
        code: error.code,
        details: {},
      };
    }
    const failure =
      error instanceof ProbeFailure
        ? error
        : new ProbeFailure("unexpected_error");
    return {
      provider,
      branch: failure.branch,
      required,
      state: "failed",
      code: failure.code,
      details: {},
    };
  }
}

function help(): void {
  console.log(`AiChart safe provider release validator

Usage:
  npm run test:provider-release
  npm run test:provider-release -- --self-test

Default required providers:
  openai,oanda,execution

Configuration:
  PROVIDER_RELEASE_REQUIRED=openai,oanda,execution,research,telegram
  PROVIDER_RELEASE_SYMBOL=EURUSD
  PROVIDER_RELEASE_EXECUTION_BRANCH=ea|mt5local
  PROVIDER_RELEASE_EA_USER_ID=<existing tenant id>
  PROVIDER_RELEASE_MT5_LOGIN=<existing account login>
  PROVIDER_RELEASE_MT5_SERVER=<existing server, optional>
  PROVIDER_RELEASE_RESEARCH_SMOKE=1
  PROVIDER_RELEASE_RESEARCH_SCRATCH_ACK=1
  PROVIDER_RELEASE_RESEARCH_SCRATCH_USER_ID=<dedicated scratch tenant id>

The validator never prints credentials, account identifiers, model output, or
provider error bodies. It refuses trading commands, order/close endpoints,
Telegram sends/webhook mutation, and arbitrary Research Service jobs.`);
}

function expectPolicyRefusal(
  operation: SafeOperation,
  url: string,
  method: string,
): void {
  let refused = false;
  try {
    assertAllowedOperation(operation, url, method);
  } catch (error) {
    refused =
      error instanceof ProbeFailure &&
      error.code === "mutation_capable_operation_refused";
  }
  if (!refused) fail("self_test_policy_did_not_refuse", "self-test");
}

function selfTest(): void {
  assertAllowedOperation(
    "oanda.candles",
    "https://api-fxpractice.oanda.com/v3/instruments/EUR_USD/candles",
    "GET",
  );
  assertAllowedOperation(
    "telegram.getMe",
    "https://api.telegram.org/botredacted/getMe",
    "GET",
  );
  expectPolicyRefusal(
    "oanda.candles",
    "https://api-fxpractice.oanda.com/v3/accounts/x/orders",
    "POST",
  );
  expectPolicyRefusal(
    "mt5.price",
    "http://127.0.0.1:18812/order",
    "POST",
  );
  expectPolicyRefusal(
    "telegram.getMe",
    "https://api.telegram.org/botredacted/sendMessage",
    "GET",
  );
  expectPolicyRefusal(
    "research.smoke_read",
    "http://127.0.0.1:8090/internal/research/jobs/x/cancel",
    "POST",
  );
  console.log(
    JSON.stringify({
      validator: "aichart-provider-release",
      selfTest: "passed",
      mutationCapableOperationsRefused: true,
      networkCalls: 0,
    }),
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    help();
    return;
  }
  if (args.includes("--self-test")) {
    selfTest();
    return;
  }
  if (args.length > 0) fail("argument_invalid", "validator");

  const required = requiredProviders();
  const results: ProbeResult[] = [];
  results.push(
    await captureProbe("openai", required.has("openai"), probeOpenAI),
  );
  results.push(
    await captureProbe("oanda", required.has("oanda"), probeOanda),
  );
  results.push(
    await captureProbe("research", required.has("research"), probeResearch),
  );
  results.push(
    await captureProbe(
      "execution",
      required.has("execution"),
      probeExecution,
    ),
  );
  results.push(
    await captureProbe(
      "telegram",
      required.has("telegram"),
      probeTelegram,
    ),
  );

  const ok = results.every((result) => result.state !== "failed");
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        validator: "aichart-provider-release",
        ok,
        safety: {
          credentialsLogged: false,
          modelOutputLogged: false,
          providerErrorBodiesLogged: false,
          mutationCapableOperationsRefused: true,
          tradeCommandsEnqueued: false,
          tradesExecuted: false,
        },
        results,
      },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  const failure =
    error instanceof ProbeFailure
      ? error
      : new ProbeFailure("unexpected_error", "validator");
  console.error(
    JSON.stringify({
      validator: "aichart-provider-release",
      ok: false,
      state: "failed",
      branch: failure.branch,
      code: failure.code,
      credentialsLogged: false,
      modelOutputLogged: false,
    }),
  );
  process.exitCode = 1;
});
