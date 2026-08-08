/**
 * Security coverage for webhookDelivery.ts (plan §A5 — the highest-risk new
 * component in the watchlist/monitors feature). If these assertions hold,
 * the resolve-then-pin SSRF defense actually rejects the address ranges it
 * claims to.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPublicIpv4,
  isPublicIpv6,
  resolveAndPin,
  WebhookDeliveryError,
} from "@/lib/quantAgent/webhookDelivery";

describe("isPublicIpv4", () => {
  const blocked = [
    "127.0.0.1", // loopback
    "10.0.0.1", // private
    "172.16.0.1", // private
    "172.31.255.255", // private (upper bound of 172.16.0.0/12)
    "192.168.1.1", // private
    "169.254.169.254", // link-local — cloud metadata endpoint
    "100.64.0.1", // CGNAT
    "0.0.0.0",
    "192.0.2.1", // TEST-NET-1
    "198.51.100.1", // TEST-NET-2
    "203.0.113.1", // TEST-NET-3
    "224.0.0.1", // multicast
    "240.0.0.1", // reserved
    "255.255.255.255", // limited broadcast
  ];
  for (const address of blocked) {
    it(`rejects ${address}`, () => {
      assert.equal(isPublicIpv4(address), false);
    });
  }

  const allowed = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.255.255", "172.32.0.1"];
  for (const address of allowed) {
    it(`accepts ${address}`, () => {
      assert.equal(isPublicIpv4(address), true);
    });
  }
});

describe("isPublicIpv6", () => {
  const blocked = [
    "::1", // loopback
    "::", // unspecified
    "fe80::1", // link-local
    "febf:ffff::1", // upper bound of fe80::/10
    "fc00::1", // unique local
    "fdff:ffff::1",
    "ff02::1", // multicast
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:10.0.0.1", // IPv4-mapped private
    "::ffff:169.254.169.254", // IPv4-mapped metadata endpoint
  ];
  for (const address of blocked) {
    it(`rejects ${address}`, () => {
      assert.equal(isPublicIpv6(address), false);
    });
  }

  const allowed = ["2001:4860:4860::8888", "::ffff:8.8.8.8"];
  for (const address of allowed) {
    it(`accepts ${address}`, () => {
      assert.equal(isPublicIpv6(address), true);
    });
  }
});

describe("resolveAndPin", () => {
  it("rejects a non-https URL before any DNS lookup", async () => {
    let lookupCalled = false;
    await assert.rejects(
      () =>
        resolveAndPin("http://example.com/hook", async () => {
          lookupCalled = true;
          return [{ address: "8.8.8.8", family: 4 }];
        }),
      (error: unknown) => error instanceof WebhookDeliveryError && error.code === "NOT_HTTPS",
    );
    assert.equal(lookupCalled, false);
  });

  it("rejects a malformed URL", async () => {
    await assert.rejects(
      () => resolveAndPin("not a url", async () => []),
      (error: unknown) => error instanceof WebhookDeliveryError && error.code === "INVALID_URL",
    );
  });

  it("rejects when the hostname resolves to a private address", async () => {
    await assert.rejects(
      () =>
        resolveAndPin("https://attacker.example/hook", async () => [
          { address: "169.254.169.254", family: 4 },
        ]),
      (error: unknown) => error instanceof WebhookDeliveryError && error.code === "PRIVATE_ADDRESS",
    );
  });

  it("rejects when ANY resolved address is private, even if another is public (DNS-rebinding-style multi-answer)", async () => {
    await assert.rejects(
      () =>
        resolveAndPin("https://mixed.example/hook", async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ]),
      (error: unknown) => error instanceof WebhookDeliveryError && error.code === "PRIVATE_ADDRESS",
    );
  });

  it("pins the resolved public address and keeps the original hostname for TLS/Host", async () => {
    const target = await resolveAndPin("https://hooks.example.com/notify?x=1", async () => [
      { address: "93.184.216.34", family: 4 },
    ]);
    assert.equal(target.hostname, "hooks.example.com");
    assert.equal(target.address, "93.184.216.34");
    assert.equal(target.path, "/notify?x=1");
  });

  it("propagates a DNS lookup failure as DNS_FAILED", async () => {
    await assert.rejects(
      () =>
        resolveAndPin("https://nonexistent.invalid/hook", async () => {
          throw new Error("ENOTFOUND");
        }),
      (error: unknown) => error instanceof WebhookDeliveryError && error.code === "DNS_FAILED",
    );
  });
});
