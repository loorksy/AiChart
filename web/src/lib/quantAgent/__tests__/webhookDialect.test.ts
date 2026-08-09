/**
 * Webhook dialect coverage: detection, per-vendor body shape, the vendor
 * responses that are failures dressed as HTTP 200, and the signing contract.
 *
 * The signature assertions are the load-bearing ones. "The bytes posted must
 * be the bytes signed" is the whole contract a generic receiver verifies
 * against, and it is broken by re-serializing the payload once for the HMAC
 * and again for the request — which produces a signature that is correct for a
 * body nobody ever sent, and a receiver that rejects everything for reasons
 * nobody can reproduce.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  adaptPayloadForDialect,
  buildWebhookText,
  checkVendorResponse,
  detectWebhookDialect,
  dingtalkSignedUrl,
  encodeWebhookBody,
  feishuSign,
  formatWebhookNumber,
  shortenWebhookText,
  signWebhookBody,
  type WebhookSignalPayload,
} from "@/lib/quantAgent/notifications/webhookDialect";
import { buildWebhookRequest } from "@/lib/quantAgent/webhookDelivery";

const PAYLOAD: WebhookSignalPayload = {
  monitor_id: "42",
  symbol: "XAUUSD",
  market: "forex",
  interval: "1h",
  recommendation_id: "rec-abc",
  decision: "SELL",
  direction: "sell",
  entry: 2410.5,
  stop_loss: 2425,
  take_profit: null,
  confidence: 71,
  rationale: "EMA20 crossed below EMA50 with ADX 27.",
  fire_rule: "on_change",
  fired_at: "2026-01-02T10:00:00.000Z",
};

describe("detectWebhookDialect", () => {
  const cases: [string, string][] = [
    ["https://open.feishu.cn/open-apis/bot/v2/hook/abc123", "feishu"],
    ["https://open.larksuite.com/open-apis/bot/v2/hook/abc123", "feishu"],
    ["https://open.larkoffice.com/open-apis/bot/v2/hook/abc", "feishu"],
    ["https://oapi.dingtalk.com/robot/send?access_token=x", "dingtalk"],
    ["https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x", "wecom"],
    ["https://hooks.slack.com/services/T000/B000/XXXX", "slack"],
    ["https://example.com/hooks/quant", "generic"],
    ["not a url", "generic"],
  ];
  for (const [url, expected] of cases) {
    it(`${url} => ${expected}`, () => {
      assert.equal(detectWebhookDialect(url), expected);
    });
  }

  it("does not claim a vendor on host alone — the bot path is part of the identity", () => {
    // The upstream copy that shipped matched on host only, so any DingTalk URL
    // got a DingTalk body regardless of what it actually pointed at.
    assert.equal(detectWebhookDialect("https://oapi.dingtalk.com/some/other/api"), "generic");
    assert.equal(detectWebhookDialect("https://hooks.slack.com/workflows/abc"), "generic");
  });

  it("a hostile host cannot CLAIM a vendor by putting the vendor's path in its own", () => {
    // This is the security case, not a tidiness one. The dialect decides where
    // the operator's shared signing secret goes: a DingTalk classification
    // appends HMAC-SHA256(secret, "{ms}\n{secret}") to the outbound URL, and a
    // Feishu one puts the equivalent digest in the body. Upstream matches
    // `prefix in url.lower()`, so every URL below would be classified as a
    // vendor and would hand an attacker-controlled host an offline-crackable
    // oracle for QUANT_AGENT_WEBHOOK_SIGNING_SECRET.
    const impostors = [
      "https://evil.example.com/oapi.dingtalk.com/robot/send",
      "https://evil.example.com/open.feishu.cn/open-apis/bot/v2/hook/x",
      "https://evil.example.com/hooks.slack.com/services/T/B/X",
      "https://evil.example.com/qyapi.weixin.qq.com/cgi-bin/webhook/send",
      // Look-alike hostnames: suffix and prefix, both exact-compare failures.
      "https://oapi.dingtalk.com.evil.example.com/robot/send",
      "https://notoapi.dingtalk.com/robot/send",
      "https://evil.example.com/x?next=https://oapi.dingtalk.com/robot/send",
    ];
    for (const url of impostors) {
      assert.equal(detectWebhookDialect(url), "generic", `${url} must not be trusted as a vendor`);
    }
  });

  it("only https can be a vendor — the transport posts nothing else", () => {
    assert.equal(detectWebhookDialect("http://oapi.dingtalk.com/robot/send"), "generic");
  });
});

describe("buildWebhookText", () => {
  it("omits levels the engine never produced instead of printing 0", () => {
    const { title, body } = buildWebhookText(PAYLOAD);
    assert.equal(title, "Quant Agent · XAUUSD · SELL");
    assert.match(body, /^Symbol: XAUUSD$/m);
    assert.match(body, /^Timeframe: 1h$/m);
    assert.match(body, /^Entry: 2410\.5$/m);
    assert.match(body, /^Stop loss: 2425$/m);
    assert.doesNotMatch(body, /Take profit/, "an absent take-profit is absent, not 0");
    assert.match(body, /^Confidence: 71%$/m);
    assert.match(body, /EMA20 crossed below EMA50/);
  });

  it("drops confidence entirely when it is unknown", () => {
    const { body } = buildWebhookText({ ...PAYLOAD, confidence: null });
    assert.doesNotMatch(body, /Confidence/);
  });
});

describe("formatWebhookNumber", () => {
  it("keeps precision and strips the padding zeros", () => {
    assert.equal(formatWebhookNumber(2410.5), "2410.5");
    assert.equal(formatWebhookNumber(0.00012345), "0.00012345");
    assert.equal(formatWebhookNumber(100), "100");
  });
  it("has no rendering for an absent or non-finite number", () => {
    assert.equal(formatWebhookNumber(null), null);
    assert.equal(formatWebhookNumber(undefined), null);
    assert.equal(formatWebhookNumber(Number.NaN), null);
    assert.equal(formatWebhookNumber(Number.POSITIVE_INFINITY), null);
  });
});

describe("adaptPayloadForDialect", () => {
  it("feishu takes plain text", () => {
    const body = adaptPayloadForDialect("feishu", PAYLOAD) as {
      msg_type: string;
      content: { text: string };
    };
    assert.equal(body.msg_type, "text");
    assert.match(body.content.text, /^Quant Agent · XAUUSD · SELL\n/);
  });

  it("dingtalk takes markdown with its own title field", () => {
    const body = adaptPayloadForDialect("dingtalk", PAYLOAD) as {
      msgtype: string;
      markdown: { title: string; text: string };
    };
    assert.equal(body.msgtype, "markdown");
    assert.equal(body.markdown.title, "Quant Agent · XAUUSD · SELL");
    assert.match(body.markdown.text, /^### Quant Agent · XAUUSD · SELL\n\n/);
  });

  it("wecom takes markdown under `content`, not `title`/`text`", () => {
    const body = adaptPayloadForDialect("wecom", PAYLOAD) as {
      msgtype: string;
      markdown: { content: string };
    };
    assert.equal(body.msgtype, "markdown");
    assert.match(body.markdown.content, /^### Quant Agent · XAUUSD · SELL\n\n/);
  });

  it("slack takes a bold title over the body", () => {
    const body = adaptPayloadForDialect("slack", PAYLOAD) as { text: string };
    assert.match(body.text, /^\*Quant Agent · XAUUSD · SELL\*\n/);
  });

  it("generic gets the internal payload untouched", () => {
    assert.equal(adaptPayloadForDialect("generic", PAYLOAD), PAYLOAD);
  });

  it("caps a very long body so the vendor does not reject the whole message", () => {
    const long = { ...PAYLOAD, rationale: "x".repeat(9000) };
    const body = adaptPayloadForDialect("slack", long) as { text: string };
    // title line + 4000-capped body
    assert.ok(body.text.length < 4200, `slack body was ${body.text.length} chars`);
    assert.match(body.text, /\.\.\.$/);
  });
});

describe("shortenWebhookText", () => {
  it("marks the truncation instead of silently cutting", () => {
    assert.equal(shortenWebhookText("abcdef", 6), "abcdef");
    assert.equal(shortenWebhookText("abcdefg", 6), "abc...");
  });
});

describe("checkVendorResponse", () => {
  it("treats Slack's literal `ok` as success", () => {
    assert.deepEqual(checkVendorResponse("slack", 200, "ok"), { ok: true, error: "" });
    assert.deepEqual(checkVendorResponse("slack", 200, "{}"), { ok: true, error: "" });
  });

  it("treats any other Slack body as a failure", () => {
    const verdict = checkVendorResponse("slack", 200, "invalid_token");
    assert.equal(verdict.ok, false);
    assert.match(verdict.error, /^slack_unexpected:invalid_token$/);
  });

  it("reads the vendor error code out of a 200 body", () => {
    const feishu = checkVendorResponse("feishu", 200, '{"code":19021,"msg":"sign match fail"}');
    assert.equal(feishu.ok, false);
    assert.match(feishu.error, /feishu_error:code=19021:sign match fail/);

    const dingtalk = checkVendorResponse("dingtalk", 200, '{"errcode":310000,"errmsg":"keywords not in content"}');
    assert.equal(dingtalk.ok, false);
    assert.match(dingtalk.error, /dingtalk_error:code=310000/);

    const wecom = checkVendorResponse("wecom", 200, '{"errcode":0,"errmsg":"ok"}');
    assert.deepEqual(wecom, { ok: true, error: "" });
  });

  it("accepts an empty or non-JSON 2xx from the Chinese vendors", () => {
    assert.equal(checkVendorResponse("feishu", 200, "").ok, true);
    assert.equal(checkVendorResponse("wecom", 204, "no content").ok, true);
  });

  it("any non-2xx is a failure whatever the dialect", () => {
    const verdict = checkVendorResponse("generic", 502, "bad gateway");
    assert.equal(verdict.ok, false);
    assert.match(verdict.error, /^http_502:bad gateway$/);
  });
});

describe("signing", () => {
  it("feishu keys the HMAC with `{ts}\\n{secret}` over an EMPTY message", () => {
    const expected = createHmac("sha256", "1735812000\ns3cret").update("").digest("base64");
    assert.equal(feishuSign("s3cret", 1735812000), expected);
  });

  it("dingtalk signs `{ms}\\n{secret}` keyed by the secret, url-encoded into the query", () => {
    const url = dingtalkSignedUrl("https://oapi.dingtalk.com/robot/send?access_token=t", "s3cret", 1735812000123);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("access_token"), "t", "the existing query survives");
    assert.equal(parsed.searchParams.get("timestamp"), "1735812000123");
    const expected = createHmac("sha256", "s3cret")
      .update("1735812000123\ns3cret")
      .digest("base64");
    // URLSearchParams decodes, so this compares the raw base64 including +/=.
    assert.equal(parsed.searchParams.get("sign"), expected);
  });

  it("appends with `?` when the URL has no query yet", () => {
    const url = dingtalkSignedUrl("https://oapi.dingtalk.com/robot/send", "s", 1);
    assert.match(url, /robot\/send\?timestamp=1&sign=/);
  });

  it("the generic signature is HMAC-SHA256 over `{ts}.` + the compact body", () => {
    const body = encodeWebhookBody({ b: 1, a: "ü" });
    const expected = createHmac("sha256", "s3cret")
      .update(Buffer.concat([Buffer.from("1735812000.", "utf8"), body]))
      .digest("hex");
    assert.equal(signWebhookBody("s3cret", 1735812000, body), expected);
    assert.equal(body.toString("utf8"), '{"b":1,"a":"ü"}', "compact, non-ASCII preserved");
  });
});

describe("buildWebhookRequest", () => {
  const NOW = 1735812000123; // ms
  const TS = Math.floor(NOW / 1000);

  it("signs exactly the bytes it posts for a generic receiver", () => {
    const plan = buildWebhookRequest("https://example.com/hook", PAYLOAD, {
      signingSecret: "s3cret",
      nowMs: NOW,
      requestId: "req-1",
    });
    assert.equal(plan.dialect, "generic");
    assert.equal(plan.postUrl, "https://example.com/hook");
    assert.equal(plan.headers["X-AiChart-Timestamp"], String(TS));

    // Re-derive the signature from the EXACT buffer that will be written to
    // the socket. If the implementation ever re-serializes, this fails.
    const expected = createHmac("sha256", "s3cret")
      .update(Buffer.concat([Buffer.from(`${TS}.`, "utf8"), plan.body]))
      .digest("hex");
    assert.equal(plan.headers["X-AiChart-Signature"], expected);
    assert.equal(plan.headers["Content-Length"], plan.body.byteLength);
    assert.deepEqual(JSON.parse(plan.body.toString("utf8")), PAYLOAD);
  });

  it("leaves a generic body unsigned when no secret is configured", () => {
    const plan = buildWebhookRequest("https://example.com/hook", PAYLOAD, {
      signingSecret: "",
      nowMs: NOW,
    });
    assert.equal(plan.headers["X-AiChart-Signature"], undefined);
    assert.equal(plan.headers["X-AiChart-Timestamp"], undefined);
  });

  it("puts feishu's signature IN the body and serializes after, not before", () => {
    const plan = buildWebhookRequest(
      "https://open.feishu.cn/open-apis/bot/v2/hook/abc",
      PAYLOAD,
      { signingSecret: "s3cret", nowMs: NOW },
    );
    assert.equal(plan.dialect, "feishu");
    const body = JSON.parse(plan.body.toString("utf8")) as Record<string, unknown>;
    assert.equal(body.timestamp, String(TS));
    assert.equal(body.sign, feishuSign("s3cret", TS));
    assert.equal(body.msg_type, "text");
    // No header signature: feishu carries it in the body.
    assert.equal(plan.headers["X-AiChart-Signature"], undefined);
  });

  it("puts dingtalk's signature in the URL, leaving the body a plain markdown envelope", () => {
    const plan = buildWebhookRequest(
      "https://oapi.dingtalk.com/robot/send?access_token=t",
      PAYLOAD,
      { signingSecret: "s3cret", nowMs: NOW },
    );
    assert.equal(plan.dialect, "dingtalk");
    assert.match(plan.postUrl, /[?&]sign=/);
    assert.match(plan.postUrl, /[?&]timestamp=1735812000123/);
    const body = JSON.parse(plan.body.toString("utf8")) as { msgtype: string };
    assert.equal(body.msgtype, "markdown");
    assert.equal(plan.headers["X-AiChart-Signature"], undefined);
  });

  it("never signs wecom or slack — their secret is the URL itself", () => {
    for (const url of [
      "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k",
      "https://hooks.slack.com/services/T/B/X",
    ]) {
      const plan = buildWebhookRequest(url, PAYLOAD, { signingSecret: "s3cret", nowMs: NOW });
      assert.equal(plan.postUrl, url, "the URL is posted verbatim");
      assert.equal(plan.headers["X-AiChart-Signature"], undefined);
    }
  });
});
