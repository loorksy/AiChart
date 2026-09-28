/**
 * GitHub REST verification used by Cursor/admin/deploy gates.
 *
 * Production VPS IPs share GitHub's unauthenticated 60 req/hour budget.
 * A rate-limit response used to fail the whole Cursor/admin/deploy gate
 * with github.verify.failed. That path is now a soft skip.
 *
 * Rules:
 *   - If GITHUB_TOKEN / GH_TOKEN / GITHUB_DEPLOY_TOKEN is set, send
 *     `Authorization: Bearer` so the call is authenticated (5,000 req/hour).
 *   - A 403/429 rate-limit is a soft skip (or the last successful result),
 *     never a hard deploy/Cursor failure. Do not retry-spam it.
 *   - Transient 5xx/network errors may retry with backoff.
 *   - A reachable, non-limited GitHub still runs the real check.
 */

import { fetchWithTimeout } from "./externalFetch";
import { t, type AppLocale } from "./i18n";

export const GITHUB_TOKEN_ENV_KEYS = [
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_DEPLOY_TOKEN",
] as const;

export const DEFAULT_GITHUB_OWNER = "loorksy";
export const DEFAULT_GITHUB_REPO = "AiChart";
export const DEFAULT_GITHUB_API_URL = "https://api.github.com";

export type GithubVerifyStatus = "ok" | "skipped_rate_limit" | "failed";

export interface GithubVerifyResult {
  /** True for a live success *or* a rate-limit skip (soft). */
  ok: boolean;
  /** True only when the gate must fail the caller. Rate-limit is never this. */
  hardFailure: boolean;
  status: GithubVerifyStatus;
  authenticated: boolean;
  message: string;
  detail?: string;
  cached?: boolean;
  httpStatus?: number;
}

export interface GithubVerifyCache {
  get(): GithubVerifyResult | null;
  set(result: GithubVerifyResult): void;
}

export interface VerifyGithubOptions {
  owner?: string;
  repo?: string;
  sha?: string;
  locale?: AppLocale;
  apiUrl?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  nowMs?: number;
  cache?: GithubVerifyCache;
  /** Override sleep in tests. Default is real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Max extra attempts after the first for retryable 5xx/network only. */
  maxRetries?: number;
}

const USER_AGENT = "aichart-github-verify";
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 250;
const RETRY_MAX_MS = 2_000;
/** Do not re-hit GitHub after a 403/429 rate-limit (healthz/admin must not spam). */
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;

const RATE_LIMIT_BODY =
  /rate limit exceeded|api rate limit|secondary rate limit|authenticated requests get a higher rate limit/i;

let memoryCache: GithubVerifyResult | null = null;
let rateLimitCooldownUntilMs = 0;
let rateLimitCooldownResult: GithubVerifyResult | null = null;

const defaultCache: GithubVerifyCache = {
  get: () => memoryCache,
  set: (result) => {
    memoryCache = result;
  },
};

/** Test seam — drop the process-local last-success and rate-limit cooldown caches. */
export function __resetGithubVerifyCache(): void {
  memoryCache = null;
  rateLimitCooldownUntilMs = 0;
  rateLimitCooldownResult = null;
}

/** Thrown/network bodies that are GitHub rate-limits, not generic failures. */
export function isGithubRateLimitDetail(text: string): boolean {
  return RATE_LIMIT_BODY.test(text);
}

/** Cursor/VPS healthz includes GitHub only when asked — never on the cheap probe. */
export function shouldIncludeGithubOnHealthz(opts: {
  searchParams?: { get(name: string): string | null };
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (opts.searchParams?.get("github") === "1") return true;
  const flag = (opts.env ?? process.env).HEALTHZ_VERIFY_GITHUB?.trim();
  return flag === "1" || flag === "true";
}

export function githubVerifyPublic(result: GithubVerifyResult): {
  status: GithubVerifyStatus;
  ok: boolean;
  hardFailure: boolean;
  authenticated: boolean;
  message: string;
  cached: boolean;
} {
  return {
    status: result.status,
    ok: result.ok,
    hardFailure: result.hardFailure,
    authenticated: result.authenticated,
    message: result.message,
    cached: Boolean(result.cached),
  };
}

export function githubTokenFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  for (const key of GITHUB_TOKEN_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}

export function githubAuthHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function resolveGithubRepo(env: NodeJS.ProcessEnv = process.env): {
  owner: string;
  repo: string;
} {
  const named = env.GITHUB_REPOSITORY?.trim();
  if (named) {
    const [owner, repo] = named.split("/");
    if (owner && repo) return { owner, repo };
  }
  return {
    owner: env.GITHUB_OWNER?.trim() || DEFAULT_GITHUB_OWNER,
    repo: env.GITHUB_REPO?.trim() || DEFAULT_GITHUB_REPO,
  };
}

export function isGithubRateLimitResponse(opts: {
  status: number;
  bodyText: string;
  remaining?: string | null;
}): boolean {
  if (opts.remaining?.trim() === "0") return true;
  if (opts.status !== 403 && opts.status !== 429) return false;
  return RATE_LIMIT_BODY.test(opts.bodyText);
}

/** Rate-limit 403/429 must never be retried. 5xx and network errors may. */
export function shouldRetryGithub(opts: {
  status?: number;
  rateLimited: boolean;
  networkError: boolean;
}): boolean {
  if (opts.rateLimited) return false;
  if (opts.networkError) return true;
  if (opts.status !== undefined && opts.status >= 500) return true;
  return false;
}

export function githubVerifyExitCode(result: GithubVerifyResult): number {
  return result.hardFailure ? 1 : 0;
}

function githubErrorDetail(bodyText: string, fallback: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed) return fallback;
  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    // GitHub sometimes returns a plain-text body; use it as-is.
  }
  return trimmed.slice(0, 400);
}

function failed(
  locale: AppLocale,
  detail: string,
  extras: Partial<GithubVerifyResult> = {},
): GithubVerifyResult {
  return {
    ok: false,
    hardFailure: true,
    status: "failed",
    authenticated: false,
    message: t(locale, "github.verify.failed", { detail }),
    detail,
    ...extras,
  };
}

function skippedRateLimit(
  locale: AppLocale,
  authenticated: boolean,
  detail: string,
  cached?: GithubVerifyResult | null,
): GithubVerifyResult {
  if (cached && cached.status === "ok") {
    return {
      ...cached,
      ok: true,
      hardFailure: false,
      status: "skipped_rate_limit",
      authenticated,
      cached: true,
      message: t(locale, "github.verify.rate_limit_cached"),
      detail,
    };
  }
  return {
    ok: true,
    hardFailure: false,
    status: "skipped_rate_limit",
    authenticated,
    message: t(locale, "github.verify.rate_limit_skip"),
    detail,
  };
}

function sleepMs(
  ms: number,
  sleep: ((ms: number) => Promise<void>) | undefined,
): Promise<void> {
  if (sleep) return sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
}

function requestInfoUrl(requestUrl: RequestInfo | URL): string {
  if (typeof requestUrl === "string") return requestUrl;
  if (requestUrl instanceof URL) return requestUrl.href;
  return requestUrl.url;
}

export async function verifyGithub(
  opts: VerifyGithubOptions = {},
): Promise<GithubVerifyResult> {
  const env = opts.env ?? process.env;
  const locale = opts.locale ?? "ar";
  const token = githubTokenFromEnv(env);
  const authenticated = Boolean(token);
  const { owner, repo } = {
    ...resolveGithubRepo(env),
    ...(opts.owner ? { owner: opts.owner } : {}),
    ...(opts.repo ? { repo: opts.repo } : {}),
  };
  const apiUrl = (opts.apiUrl ?? env.GITHUB_API_URL ?? DEFAULT_GITHUB_API_URL)
    .trim()
    .replace(/\/+$/, "");
  const path = opts.sha
    ? `/repos/${owner}/${repo}/commits/${opts.sha}`
    : `/repos/${owner}/${repo}`;
  const url = `${apiUrl}${path}`;
  const cache = opts.cache ?? defaultCache;
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const doFetch: typeof fetch = opts.fetchImpl
    ? opts.fetchImpl
    : ((requestUrl, init) =>
        fetchWithTimeout(requestInfoUrl(requestUrl), init ?? {}, {
          timeoutMs: 15_000,
          label: "GitHub",
        })) as typeof fetch;

  const headers = githubAuthHeaders(token);
  const nowMs = opts.nowMs ?? Date.now();
  if (
    rateLimitCooldownResult &&
    nowMs < rateLimitCooldownUntilMs
  ) {
    return skippedRateLimit(
      locale,
      authenticated,
      rateLimitCooldownResult.detail ?? "rate-limited",
      cache.get(),
    );
  }

  let lastDetail = "unknown";
  let lastStatus: number | undefined;

  const rememberRateLimit = (detail: string): GithubVerifyResult => {
    const skip = skippedRateLimit(locale, authenticated, detail, cache.get());
    rateLimitCooldownUntilMs = nowMs + RATE_LIMIT_COOLDOWN_MS;
    rateLimitCooldownResult = skip;
    return skip;
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await doFetch(url, { headers, method: "GET" });
      lastStatus = res.status;
      const bodyText = await res.text();
      lastDetail = githubErrorDetail(bodyText, `HTTP ${res.status}`);
      const rateLimited = isGithubRateLimitResponse({
        status: res.status,
        bodyText: `${bodyText}\n${lastDetail}`,
        remaining: res.headers.get("x-ratelimit-remaining"),
      });

      if (rateLimited) {
        return rememberRateLimit(lastDetail);
      }

      if (res.ok) {
        const result: GithubVerifyResult = {
          ok: true,
          hardFailure: false,
          status: "ok",
          authenticated,
          message: t(locale, "github.verify.ok"),
          httpStatus: res.status,
        };
        cache.set(result);
        return result;
      }

      if (
        attempt < maxRetries &&
        shouldRetryGithub({
          status: res.status,
          rateLimited: false,
          networkError: false,
        })
      ) {
        await sleepMs(backoffMs(attempt), opts.sleep);
        continue;
      }

      return failed(locale, lastDetail, {
        authenticated,
        httpStatus: res.status,
      });
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
      if (isGithubRateLimitDetail(lastDetail)) {
        return rememberRateLimit(lastDetail);
      }
      if (
        attempt < maxRetries &&
        shouldRetryGithub({ rateLimited: false, networkError: true })
      ) {
        await sleepMs(backoffMs(attempt), opts.sleep);
        continue;
      }
      return failed(locale, lastDetail, { authenticated, httpStatus: lastStatus });
    }
  }

  return failed(locale, lastDetail, { authenticated, httpStatus: lastStatus });
}
