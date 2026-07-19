import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { loadConfig } from "../config.js";

const KEYS = [
  "AICHART_API_URL",
  "AICHART_API_BASE",
  "AICHART_SERVICE_TOKEN",
  "MCP_AUTH_SECRET",
  "MCP_AUTH_MODE",
] as const;

const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

function stashEnv() {
  for (const k of KEYS) saved[k] = process.env[k];
}

function restoreEnv() {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

describe("loadConfig apiUrl alias", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("prefers AICHART_API_URL over AICHART_API_BASE", () => {
    stashEnv();
    process.env.MCP_AUTH_MODE = "none";
    process.env.AICHART_API_URL = "http://127.0.0.1:3019/";
    process.env.AICHART_API_BASE = "http://127.0.0.1:3010";
    const cfg = loadConfig();
    assert.equal(cfg.apiUrl, "http://127.0.0.1:3019");
  });

  it("falls back to AICHART_API_BASE when AICHART_API_URL is unset", () => {
    stashEnv();
    process.env.MCP_AUTH_MODE = "none";
    delete process.env.AICHART_API_URL;
    process.env.AICHART_API_BASE = "http://127.0.0.1:3019";
    const cfg = loadConfig();
    assert.equal(cfg.apiUrl, "http://127.0.0.1:3019");
  });
});
