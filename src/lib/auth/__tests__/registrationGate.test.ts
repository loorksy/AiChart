import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "aichart-reg-gate-"));
process.env.DB_PATH = join(dir, "reg-gate.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "registration-gate-test-secret";
delete process.env.DATABASE_URL;
delete process.env.REGISTRATION_OPEN;

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: typeof import("@/lib/db");
let cfg: typeof import("@/lib/platformConfig");
let registration: typeof import("@/lib/auth/registration");
let oidc: typeof import("@/lib/auth/googleOidc");
let store: typeof import("@/lib/store");
let auth: typeof import("@/lib/auth");
let api: typeof import("@/lib/api");
let registerRoute: typeof import("@/app/api/auth/register/route");
let i18n: typeof import("@/lib/i18n");

const REPO = join(import.meta.dirname, "..", "..", "..", "..");

async function userCount(): Promise<number> {
  const row = await db.queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM users");
  return Number(row?.n ?? 0);
}

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  cfg = await import("@/lib/platformConfig");
  registration = await import("@/lib/auth/registration");
  oidc = await import("@/lib/auth/googleOidc");
  store = await import("@/lib/store");
  auth = await import("@/lib/auth");
  api = await import("@/lib/api");
  registerRoute = await import("@/app/api/auth/register/route");
  i18n = await import("@/lib/i18n");
});

beforeEach(async () => {
  cfg.clearPlatformConfigCache();
  await db.execute("DELETE FROM platform_config WHERE key = ?", [
    registration.REGISTRATION_OPEN_KEY,
  ]);
  delete process.env.REGISTRATION_OPEN;
  cfg.clearPlatformConfigCache();
});

describe("isRegistrationOpen", () => {
  it("defaults to closed when the key is missing", async () => {
    assert.equal(await registration.isRegistrationOpen(), false);
    await assert.rejects(
      () => registration.assertRegistrationOpen(),
      (err: unknown) => {
        assert.ok(registration.isRegistrationClosedError(err));
        return true;
      },
    );
  });

  it("opens after the admin saves the toggle on", async () => {
    await cfg.savePlatformConfig({ REGISTRATION_OPEN: true });
    assert.equal(await registration.isRegistrationOpen(), true);
    await registration.assertRegistrationOpen();
  });

  it("stays closed when the admin saves the toggle off", async () => {
    await cfg.savePlatformConfig({ REGISTRATION_OPEN: true });
    await cfg.savePlatformConfig({ REGISTRATION_OPEN: false });
    assert.equal(await registration.isRegistrationOpen(), false);
  });

  it("treats a deleted key as closed again", async () => {
    await cfg.savePlatformConfig({ REGISTRATION_OPEN: true });
    await cfg.savePlatformConfig({ REGISTRATION_OPEN: "" });
    assert.equal(await registration.isRegistrationOpen(), false);
  });
});

describe("POST /api/auth/register", () => {
  it("rejects with a stable 403 when the key is missing — no user is created", async () => {
    const beforeCount = await userCount();
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "newtrader",
        whatsapp: "+966500000000",
        email: "new@example.com",
        password: "password1",
      }),
    });
    const res = await registerRoute.POST(req);
    assert.equal(res.status, 403);
    assert.notEqual(res.status, 500);
    const body = (await res.json()) as { error?: string; code?: string };
    assert.equal(body.code, registration.REGISTRATION_CLOSED_CODE);
    assert.ok(body.error && body.error.length > 0);
    assert.equal(await userCount(), beforeCount);
  });

  it("does not refuse at the gate once the admin has opened registration", async () => {
    await cfg.savePlatformConfig({ REGISTRATION_OPEN: true });
    assert.equal(await registration.isRegistrationOpen(), true);
    await registration.assertRegistrationOpen();
  });
});

describe("login is unchanged when registration is closed", () => {
  it("the login route never consults the registration flag", () => {
    const src = readFileSync(
      join(REPO, "src/app/api/auth/login/route.ts"),
      "utf8",
    );
    assert.doesNotMatch(src, /isRegistrationOpen|assertRegistrationOpen|REGISTRATION_OPEN/);
  });

  it("an existing password still verifies while signup is closed", async () => {
    assert.equal(await registration.isRegistrationOpen(), false);
    const email = `closed-login-${Date.now()}@example.com`;
    const password = "existing-pass-1";
    await db.execute(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?, ?, 'user', 'active')",
      [email, auth.hashPassword(password)],
    );
    const row = await db.queryOne<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE email = ?",
      [email],
    );
    assert.ok(row);
    assert.equal(auth.verifyPassword(password, row.password_hash), true);
  });
});

describe("Google first-time vs existing", () => {
  it("blocks creating a new Google account when closed", async () => {
    const beforeCount = await userCount();
    await assert.rejects(
      () =>
        oidc.resolveGoogleUser({
          sub: "g-closed-new",
          email: "brand-new-closed@gmail.com",
          emailVerified: true,
          name: "New",
        }),
      (err: unknown) => registration.isRegistrationClosedError(err),
    );
    assert.equal(await userCount(), beforeCount);
    const link = await db.queryOne(
      "SELECT user_id FROM oauth_identities WHERE provider = 'google' AND subject = 'g-closed-new'",
    );
    assert.equal(link, null);
  });

  it("still signs in a linked Google user when closed", async () => {
    const email = `g-existing-${Date.now()}@gmail.com`;
    const userId = await db.insertReturningId(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?, ?, 'user', 'active')",
      [email, auth.hashPassword("x")],
    );
    await db.execute(
      "INSERT INTO oauth_identities (provider, subject, user_id, email, created_at) VALUES ('google', ?, ?, ?, ?)",
      ["g-closed-existing", userId, email, Date.now()],
    );
    const { user, isNew } = await oidc.resolveGoogleUser({
      sub: "g-closed-existing",
      email: "changed-later@gmail.com",
      emailVerified: true,
      name: null,
    });
    assert.equal(isNew, false);
    assert.equal(user.id, userId);
  });

  it("still links a verified email to an existing account when closed", async () => {
    const email = `g-link-${Date.now()}@gmail.com`;
    const userId = await db.insertReturningId(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?, ?, 'user', 'active')",
      [email, auth.hashPassword("x")],
    );
    const { user, isNew } = await oidc.resolveGoogleUser({
      sub: `g-link-sub-${userId}`,
      email,
      emailVerified: true,
      name: "Existing",
    });
    assert.equal(isNew, false);
    assert.equal(user.id, userId);
  });

  it("creates a Google account once the admin opens registration", async () => {
    await cfg.savePlatformConfig({ REGISTRATION_OPEN: true });
    const email = `g-open-${Date.now()}@gmail.com`;
    const { user, isNew } = await oidc.resolveGoogleUser({
      sub: `g-open-${Date.now()}`,
      email,
      emailVerified: true,
      name: "Open",
    });
    assert.equal(isNew, true);
    assert.equal(user.email, email);
  });
});

describe("Telegram first-time vs existing", () => {
  it("blocks creating a new Telegram account when closed", async () => {
    const beforeCount = await userCount();
    const telegramId = 8_000_001;
    await assert.rejects(
      () =>
        store.upsertTelegramUser({
          id: telegramId,
          first_name: "New",
          username: "newtguser",
          auth_date: Math.floor(Date.now() / 1000),
          hash: "unused-here",
        }),
      (err: unknown) => registration.isRegistrationClosedError(err),
    );
    assert.equal(await userCount(), beforeCount);
    assert.equal(await store.getUserByTelegramId(telegramId), null);
  });

  it("still signs in an existing Telegram user when closed", async () => {
    const telegramId = 8_000_002;
    const email = `tg-existing-${Date.now()}@telegram.user`;
    const userId = await db.insertReturningId(
      "INSERT INTO users (email, password_hash, role, status, telegram_id) VALUES (?, ?, 'user', 'active', ?)",
      [email, auth.hashPassword("x"), telegramId],
    );
    const { user, isNew } = await store.upsertTelegramUser({
      id: telegramId,
      first_name: "Existing",
      username: "oldtg",
      auth_date: Math.floor(Date.now() / 1000),
      hash: "unused-here",
    });
    assert.equal(isNew, false);
    assert.equal(user.id, userId);
  });

  it("creates a Telegram account once the admin opens registration", async () => {
    await cfg.savePlatformConfig({ REGISTRATION_OPEN: true });
    const telegramId = 8_000_003;
    const { user, isNew } = await store.upsertTelegramUser({
      id: telegramId,
      first_name: "Open",
      username: "opentg",
      auth_date: Math.floor(Date.now() / 1000),
      hash: "unused-here",
    });
    assert.equal(isNew, true);
    assert.equal(user.telegram_id, telegramId);
  });
});

describe("stable error + admin field + i18n", () => {
  it("handleError maps RegistrationClosedError to 403 + code, not 500", async () => {
    const res = api.handleError(new registration.RegistrationClosedError());
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: string; code?: string };
    assert.equal(body.code, "REGISTRATION_CLOSED");
    assert.ok(body.error);
  });

  it("REGISTRATION_OPEN is a platform-config toggle in the ops group", () => {
    const field = cfg.PLATFORM_CONFIG_FIELDS.find((f) => f.key === "REGISTRATION_OPEN");
    assert.ok(field, "the admin panel cannot set a key that is not declared");
    assert.equal(field.type, "toggle");
    assert.equal(field.group, "ops");
    assert.equal(field.secret, false);
  });

  it("the register route is gated and the login route is not", () => {
    const registerSrc = readFileSync(
      join(REPO, "src/app/api/auth/register/route.ts"),
      "utf8",
    );
    const loginSrc = readFileSync(join(REPO, "src/app/api/auth/login/route.ts"), "utf8");
    assert.match(registerSrc, /assertRegistrationOpen/);
    assert.doesNotMatch(loginSrc, /assertRegistrationOpen|isRegistrationOpen/);
  });

  it("closed-registration copy exists in both locales", () => {
    const ar = i18n.t("ar", "auth.registration_closed");
    const en = i18n.t("en", "auth.registration_closed");
    assert.match(ar, /التسجيل مغلق/);
    assert.match(en, /Registration is currently closed/);
    assert.equal(i18n.t("ar", "auth.registration_closed_title"), "التسجيل مغلق");
    assert.equal(i18n.t("en", "auth.registration_closed_title"), "Registration is closed");
  });
});
