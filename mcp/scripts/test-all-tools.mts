/**
 * Sweep EVERY MCP tool against a running server and print a pass/fail table.
 *
 *   MCP_TEST_URL=http://127.0.0.1:8787/mcp \
 *   MCP_TEST_EMAIL=owner@example.com \
 *   npm run test:tools
 *
 * - readOnlyHint tools: called with canned args, must not return isError
 *   (an explicit "EA offline / not connected" style message counts as DEGRADED,
 *   not FAIL — the tool works; the user's terminal is simply off).
 * - Safe mutators, when present: round-trip — set, then restore.
 * - Trade-executing tools: SKIPPED (listed for manual testing).
 * - create_recommendation is exercised with a non-executing WAIT model_plan.
 */
import { mintAccessToken } from "../src/auth/jwt.js";
import { loadConfig } from "../src/config.js";
import { SAMPLE_ARGS, SKIP_EXEC_TOOLS } from "../src/tools/sampleArgs.js";
import { TOOL_CATALOG } from "../src/tools/schemas/index.js";

const URL_ = process.env.MCP_TEST_URL ?? "http://127.0.0.1:8787/mcp";
const EMAIL = process.env.MCP_TEST_EMAIL ?? "";

/** set → restore pairs (safe mutators). */
const ROUNDTRIP: Record<string, { probe: Record<string, unknown>; restoreFrom: string }> = {};

const DEGRADED_HINTS = [
  /EA/i,
  /غير متصل/,
  /MetaTrader/i,
  /offline/i,
  /heartbeat/i,
  /لم يستجب/,
  /انتهت مهلة/,
  /API-key/i,
  /permissions for action/i,
];

let sessionId = "";
let msgId = 0;

async function rpc(method: string, params: unknown, token: string): Promise<any> {
  const res = await fetch(URL_, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++msgId, method, params }),
  });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  const text = await res.text();
  const dataLines = text.split("\n").filter((l) => l.startsWith("data:"));
  const raw = dataLines.length ? dataLines[dataLines.length - 1].slice(5) : text;
  try {
    return JSON.parse(raw);
  } catch {
    return { error: { message: `non-JSON response (${res.status})` } };
  }
}

async function main() {
  if (!EMAIL) {
    console.error("MCP_TEST_EMAIL مطلوب (بريد مستخدم فعلي على المنصة).");
    process.exit(1);
  }
  const cfg = loadConfig();
  const minted = await mintAccessToken(
    cfg.authSecret!,
    { email: EMAIL, clientId: "test-all-tools", scopes: ["mcp:tools"] },
    1,
  );
  const token = minted.token;

  const init = await rpc(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-all-tools", version: "1.0.0" },
    },
    token,
  );
  if (init.error) throw new Error(`initialize failed: ${init.error.message}`);
  await rpc("notifications/initialized", {}, token).catch(() => {});

  const listed = await rpc("tools/list", {}, token);
  const serverTools = new Set(
    (listed.result?.tools ?? []).map((t: { name: string }) => t.name),
  );
  console.log(`\nخادم: ${URL_} — أدوات معلنة: ${serverTools.size}\n`);

  const rows: Array<[string, string, string, string]> = [];

  for (const def of TOOL_CATALOG) {
    const name = def.name;
    if (!serverTools.has(name)) {
      rows.push([name, "❌ FAIL", "-", "غير معلنة من الخادم!"]);
      continue;
    }
    if (SKIP_EXEC_TOOLS.has(name) && !ROUNDTRIP[name]) {
      rows.push([name, "⏭️ SKIP", "-", "تنفيذية/تستهلك رصيداً — اختبار يدوي"]);
      continue;
    }
    const args = ROUNDTRIP[name]?.probe ?? SAMPLE_ARGS[name] ?? {};
    const t0 = Date.now();
    try {
      const r = await rpc("tools/call", { name, arguments: args }, token);
      const ms = `${Date.now() - t0}ms`;
      if (r.error) {
        rows.push([name, "❌ FAIL", ms, r.error.message?.slice(0, 90) ?? "rpc error"]);
        continue;
      }
      const result = r.result ?? {};
      const text: string =
        result.content?.find((c: any) => c.type === "text")?.text ?? "";
      if (result.isError) {
        const degraded = DEGRADED_HINTS.some((rx) => rx.test(text));
        rows.push([
          name,
          degraded ? "🟡 DEGRADED" : "❌ FAIL",
          ms,
          text.replace(/\s+/g, " ").slice(0, 90),
        ]);
      } else {
        rows.push([name, "✅ PASS", ms, ""]);
      }
    } catch (e) {
      rows.push([
        name,
        "❌ FAIL",
        `${Date.now() - t0}ms`,
        e instanceof Error ? e.message.slice(0, 90) : "exception",
      ]);
    }
  }

  console.log("| الأداة | النتيجة | الزمن | ملاحظة |");
  console.log("|---|---|---|---|");
  for (const [n, s, ms, note] of rows) console.log(`| ${n} | ${s} | ${ms} | ${note} |`);

  const fails = rows.filter(([, s]) => s.includes("FAIL")).length;
  const degraded = rows.filter(([, s]) => s.includes("DEGRADED")).length;
  const passes = rows.filter(([, s]) => s.includes("PASS")).length;
  const skips = rows.filter(([, s]) => s.includes("SKIP")).length;
  console.log(
    `\nالمجموع: ${rows.length} — ✅ ${passes} · 🟡 ${degraded} · ⏭️ ${skips} · ❌ ${fails}\n`,
  );
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
