import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "google-oidc-")), "test.db");
delete process.env.DATABASE_URL;

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let oidc: any;

before(async () => {
  db = await import("@/lib/db");
  oidc = await import("../googleOidc");
  await db.initDb();
  await db.execute(
    "INSERT INTO users (id, email, password_hash, role, status) VALUES (10, 'existing@gmail.com', 'x', 'user', 'active')",
  );
});

describe("pkcePair", () => {
  it("produces an S256 challenge of the verifier, base64url, no padding", () => {
    const { verifier, challenge } = oidc.pkcePair();
    const expected = createHash("sha256").update(verifier).digest("base64url");
    assert.equal(challenge, expected);
    assert.ok(!challenge.includes("="));
    assert.ok(verifier.length >= 43, "RFC 7636 minimum verifier length");
  });
});

describe("buildGoogleAuthUrl", () => {
  it("carries every required OIDC parameter", () => {
    const url = new URL(
      oidc.buildGoogleAuthUrl({
        clientId: "cid.apps.googleusercontent.com",
        redirectUri: "https://app.test/api/auth/google/callback",
        state: "st-1",
        nonce: "no-1",
        codeChallenge: "ch-1",
      }),
    );
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("scope"), "openid email profile");
    assert.equal(url.searchParams.get("state"), "st-1");
    assert.equal(url.searchParams.get("nonce"), "no-1");
    assert.equal(
      url.searchParams.get("redirect_uri"),
      "https://app.test/api/auth/google/callback",
    );
  });
});

describe("resolveGoogleUser", () => {
  it("links a verified email to the existing account instead of duplicating it", async () => {
    const { user, isNew } = await oidc.resolveGoogleUser({
      sub: "g-sub-1",
      email: "existing@gmail.com",
      emailVerified: true,
      name: "Existing",
    });
    assert.equal(isNew, false);
    assert.equal(user.id, 10);
    const link = await db.queryOne(
      "SELECT user_id FROM oauth_identities WHERE provider = 'google' AND subject = 'g-sub-1'",
    );
    assert.equal(link.user_id, 10);
  });

  it("returns the linked account directly on the next sign-in", async () => {
    const { user, isNew } = await oidc.resolveGoogleUser({
      sub: "g-sub-1",
      email: "changed-later@gmail.com",
      emailVerified: true,
      name: null,
    });
    assert.equal(isNew, false);
    assert.equal(user.id, 10, "subject wins over email once linked");
  });

  it("creates a fresh active account for an unknown email", async () => {
    const { user, isNew } = await oidc.resolveGoogleUser({
      sub: "g-sub-2",
      email: "brandnew@gmail.com",
      emailVerified: true,
      name: "New",
    });
    assert.equal(isNew, true);
    assert.equal(user.email, "brandnew@gmail.com");
    assert.equal(user.status, "active");
  });

  it("REFUSES an unverified email that collides with an existing account", async () => {
    await assert.rejects(
      oidc.resolveGoogleUser({
        sub: "g-sub-3",
        email: "existing@gmail.com",
        emailVerified: false,
        name: "Mallory",
      }),
      /google_email_unverified_conflict/,
    );
    const link = await db.queryOne(
      "SELECT user_id FROM oauth_identities WHERE subject = 'g-sub-3'",
    );
    assert.equal(link, null, "no identity row on refusal");
  });
});
