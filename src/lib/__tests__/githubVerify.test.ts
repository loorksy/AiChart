import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { t } from "@/lib/i18n";
import {
  __resetGithubVerifyCache,
  githubAuthHeaders,
  githubTokenFromEnv,
  githubVerifyExitCode,
  githubVerifyPublic,
  isGithubRateLimitDetail,
  isGithubRateLimitResponse,
  shouldIncludeGithubOnHealthz,
  shouldRetryGithub,
  verifyGithub,
  type GithubVerifyCache,
  type GithubVerifyResult,
} from "@/lib/githubVerify";

const RATE_LIMIT_BODY = JSON.stringify({
  message:
    "API rate limit exceeded for 72.60.83.140. (But here's the good news: Authenticated requests get a higher rate limit. Check out the documentation for more details.)",
  documentation_url:
    "https://docs.github.com/rest/overview/rate-limits-for-the-rest-api",
});

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("github token + headers", () => {
  const saved = {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GH_TOKEN: process.env.GH_TOKEN,
    GITHUB_DEPLOY_TOKEN: process.env.GITHUB_DEPLOY_TOKEN,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("reads GITHUB_TOKEN, then GH_TOKEN, then the deploy token", () => {
    assert.equal(githubTokenFromEnv({}), null);
    assert.equal(githubTokenFromEnv({ GH_TOKEN: "gh-only" }), "gh-only");
    assert.equal(
      githubTokenFromEnv({ GITHUB_TOKEN: "primary", GH_TOKEN: "gh-only" }),
      "primary",
    );
    assert.equal(
      githubTokenFromEnv({ GITHUB_DEPLOY_TOKEN: "deploy" }),
      "deploy",
    );
  });

  it("sends Authorization: Bearer only when a token is present", () => {
    const anon = githubAuthHeaders(null);
    assert.equal(anon.Authorization, undefined);
    const auth = githubAuthHeaders("secret-token");
    assert.equal(auth.Authorization, "Bearer secret-token");
  });
});

describe("rate-limit classification", () => {
  it("recognizes GitHub's unauthenticated 403 body", () => {
    assert.equal(
      isGithubRateLimitResponse({
        status: 403,
        bodyText: RATE_LIMIT_BODY,
      }),
      true,
    );
  });

  it("treats remaining=0 as rate-limited even without the phrase", () => {
    assert.equal(
      isGithubRateLimitResponse({
        status: 403,
        bodyText: "{}",
        remaining: "0",
      }),
      true,
    );
  });

  it("does not treat a permission 403 as a rate limit", () => {
    assert.equal(
      isGithubRateLimitResponse({
        status: 403,
        bodyText: JSON.stringify({ message: "Resource not accessible by integration" }),
      }),
      false,
    );
  });

  it("never retries a rate-limit 403", () => {
    assert.equal(
      shouldRetryGithub({ status: 403, rateLimited: true, networkError: false }),
      false,
    );
    assert.equal(
      shouldRetryGithub({ status: 429, rateLimited: true, networkError: false }),
      false,
    );
    assert.equal(
      shouldRetryGithub({ status: 503, rateLimited: false, networkError: false }),
      true,
    );
  });
});

describe("verifyGithub", () => {
  beforeEach(() => __resetGithubVerifyCache());

  it("soft-skips an unauthenticated 403 rate-limit instead of a hard crash", async () => {
    let calls = 0;
    const result = await verifyGithub({
      env: {},
      locale: "ar",
      fetchImpl: (async () => {
        calls += 1;
        return jsonResponse(403, RATE_LIMIT_BODY, {
          "x-ratelimit-remaining": "0",
        });
      }) as typeof fetch,
    });

    assert.equal(calls, 1, "rate-limit 403 must not retry-spam");
    assert.equal(result.status, "skipped_rate_limit");
    assert.equal(result.ok, true);
    assert.equal(result.hardFailure, false);
    assert.equal(result.authenticated, false);
    assert.equal(githubVerifyExitCode(result), 0);
    assert.equal(result.message, t("ar", "github.verify.rate_limit_skip"));
    assert.doesNotMatch(result.message, /^تعذر التحقق من GitHub:/);
    assert.match(
      result.detail ?? "",
      /API rate limit exceeded for 72\.60\.83\.140/,
    );
  });

  it("sends Authorization: Bearer when a token is present and still verifies", async () => {
    let seenAuth = "";
    const result = await verifyGithub({
      env: { GITHUB_TOKEN: "ghs_test_token" },
      locale: "ar",
      fetchImpl: (async (_url, init) => {
        const headers = new Headers(init?.headers);
        seenAuth = headers.get("authorization") ?? "";
        return jsonResponse(200, { full_name: "loorksy/AiChart" });
      }) as typeof fetch,
    });

    assert.equal(seenAuth, "Bearer ghs_test_token");
    assert.equal(result.status, "ok");
    assert.equal(result.ok, true);
    assert.equal(result.hardFailure, false);
    assert.equal(result.authenticated, true);
    assert.equal(result.message, t("ar", "github.verify.ok"));
    assert.equal(githubVerifyExitCode(result), 0);
  });

  it("still runs a live check when GitHub is reachable without a token", async () => {
    const result = await verifyGithub({
      env: {},
      locale: "en",
      fetchImpl: (async () =>
        jsonResponse(200, { full_name: "loorksy/AiChart" })) as typeof fetch,
    });
    assert.equal(result.status, "ok");
    assert.equal(result.authenticated, false);
    assert.equal(result.message, t("en", "github.verify.ok"));
    assert.equal(githubVerifyExitCode(result), 0);
  });

  it("hard-fails a permission 403 that is not a rate limit", async () => {
    const result = await verifyGithub({
      env: { GITHUB_TOKEN: "bad-or-limited-scope" },
      locale: "ar",
      fetchImpl: (async () =>
        jsonResponse(403, {
          message: "Resource not accessible by integration",
        })) as typeof fetch,
    });
    assert.equal(result.status, "failed");
    assert.equal(result.hardFailure, true);
    assert.equal(githubVerifyExitCode(result), 1);
    assert.match(result.message, /^تعذر التحقق من GitHub:/);
  });

  it("hard-fails a real 404 and surfaces the Arabic verification prefix", async () => {
    const result = await verifyGithub({
      env: {},
      locale: "ar",
      fetchImpl: (async () =>
        jsonResponse(404, { message: "Not Found" })) as typeof fetch,
    });
    assert.equal(result.status, "failed");
    assert.equal(result.ok, false);
    assert.equal(result.hardFailure, true);
    assert.equal(githubVerifyExitCode(result), 1);
    assert.equal(result.message, t("ar", "github.verify.failed", { detail: "Not Found" }));
    assert.match(result.message, /^تعذر التحقق من GitHub:/);
  });

  it("retries a 503 then succeeds, without retrying a later rate-limit", async () => {
    const statuses: number[] = [];
    const fetchImpl = (async () => {
      const status = statuses.length === 0 ? 503 : 200;
      statuses.push(status);
      return jsonResponse(status, status === 200 ? { ok: true } : { message: "unavailable" });
    }) as typeof fetch;

    const slept: number[] = [];
    const ok = await verifyGithub({
      env: {},
      fetchImpl,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    assert.equal(ok.status, "ok");
    assert.deepEqual(statuses, [503, 200]);
    assert.equal(slept.length, 1);

    statuses.length = 0;
    const limited = await verifyGithub({
      env: {},
      locale: "ar",
      cache: { get: () => null, set: () => {} },
      fetchImpl: (async () => {
        statuses.push(403);
        return jsonResponse(403, RATE_LIMIT_BODY);
      }) as typeof fetch,
      sleep: async () => {
        throw new Error("rate-limit must not sleep/retry");
      },
    });
    assert.equal(limited.status, "skipped_rate_limit");
    assert.deepEqual(statuses, [403]);
    assert.equal(githubVerifyExitCode(limited), 0);
  });

  it("reuses the last successful result when a later call is rate-limited", async () => {
    let stored: GithubVerifyResult | null = null;
    const store: GithubVerifyCache = {
      get: () => stored,
      set: (result) => {
        stored = result;
      },
    };

    await verifyGithub({
      env: { GH_TOKEN: "tok" },
      cache: store,
      fetchImpl: (async () => jsonResponse(200, { ok: true })) as typeof fetch,
    });

    const limited = await verifyGithub({
      env: {},
      locale: "ar",
      cache: store,
      fetchImpl: (async () => jsonResponse(403, RATE_LIMIT_BODY)) as typeof fetch,
    });
    assert.equal(limited.status, "skipped_rate_limit");
    assert.equal(limited.cached, true);
    assert.equal(limited.hardFailure, false);
    assert.equal(limited.message, t("ar", "github.verify.rate_limit_cached"));
    assert.equal(githubVerifyExitCode(limited), 0);
  });

  it("soft-skips a thrown rate-limit body instead of the Arabic hard-fail prefix", async () => {
    let calls = 0;
    const result = await verifyGithub({
      env: {},
      locale: "ar",
      fetchImpl: (async () => {
        calls += 1;
        throw new Error(
          "API rate limit exceeded for 72.60.83.140. (But here's the good news: Authenticated requests get a higher rate limit. Check out the documentation for more details.)",
        );
      }) as typeof fetch,
      sleep: async () => {
        throw new Error("rate-limit must not sleep/retry");
      },
    });
    assert.equal(calls, 1, "thrown rate-limit 403 must not retry-spam");
    assert.equal(result.status, "skipped_rate_limit");
    assert.equal(result.hardFailure, false);
    assert.equal(githubVerifyExitCode(result), 0);
    assert.doesNotMatch(result.message, /^تعذر التحقق من GitHub:/);
    assert.equal(isGithubRateLimitDetail(result.detail ?? ""), true);
  });

  it("reuses the cooldown instead of re-hitting GitHub after a rate-limit", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse(403, RATE_LIMIT_BODY, { "x-ratelimit-remaining": "0" });
    }) as typeof fetch;
    const first = await verifyGithub({ env: {}, locale: "ar", fetchImpl });
    const second = await verifyGithub({
      env: {},
      locale: "ar",
      fetchImpl,
      nowMs: Date.now() + 1_000,
    });
    assert.equal(first.status, "skipped_rate_limit");
    assert.equal(second.status, "skipped_rate_limit");
    assert.equal(calls, 1, "cooldown must not retry-spam 403");
  });
});

describe("healthz / public gate helpers", () => {
  it("does not put GitHub on the cheap healthz probe", () => {
    assert.equal(
      shouldIncludeGithubOnHealthz({
        searchParams: new URLSearchParams(),
        env: {},
      }),
      false,
    );
  });

  it("includes GitHub when ?github=1 or HEALTHZ_VERIFY_GITHUB is set", () => {
    assert.equal(
      shouldIncludeGithubOnHealthz({
        searchParams: new URLSearchParams("github=1"),
        env: {},
      }),
      true,
    );
    assert.equal(
      shouldIncludeGithubOnHealthz({
        searchParams: new URLSearchParams(),
        env: { HEALTHZ_VERIFY_GITHUB: "1" },
      }),
      true,
    );
  });

  it("public payload never invents a hard fail for a rate-limit skip", () => {
    const pub = githubVerifyPublic({
      ok: true,
      hardFailure: false,
      status: "skipped_rate_limit",
      authenticated: false,
      message: t("ar", "github.verify.rate_limit_skip"),
      detail: "API rate limit exceeded for 72.60.83.140.",
    });
    assert.equal(pub.hardFailure, false);
    assert.equal(pub.ok, true);
    assert.doesNotMatch(pub.message, /^تعذر التحقق من GitHub:/);
  });
});
