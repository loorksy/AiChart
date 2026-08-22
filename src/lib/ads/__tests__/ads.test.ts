/**
 * Ads — the safety and targeting contract:
 *
 *  - image uploads pass only on MAGIC BYTES (png/jpeg/gif/webp) and the size
 *    cap; the claimed extension and Content-Type never matter;
 *  - targeting follows ACCOUNT STATE; the window bounds visibility exactly
 *    (an ended ad is invisible even while its row exists);
 *  - a dismissal is per (user, ad) and permanent — the ad never returns;
 *  - the rendering components own the rest structurally: text as TEXT nodes
 *    (no dangerouslySetInnerHTML anywhere in the ad UI), the refusal modal
 *    outranks ads, one ad per session, reduced-motion holds animation.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { join } from "node:path";
import { before, describe, it } from "node:test";

// Env FIRST — static app imports would hoist above these lines and bind the
// db module to the default dev path, so every repo module loads dynamically.
const dir = mkdtempSync(join(tmpdir(), "aichart-ads-"));
process.env.DB_PATH = join(dir, "ads.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "ads-test-secret";
delete process.env.DATABASE_URL;

let db: typeof import("@/lib/db");
let ads: typeof import("@/lib/ads/adsStore");

let seq = 0;
async function makeUser(): Promise<number> {
  seq += 1;
  return db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    [`ads-${seq}@example.com`, "x", "user", "active"],
  );
}

const SUB = { hasPaidAccess: true, planStatus: "active" };
const TRIAL = { hasPaidAccess: false, planStatus: "trial" };
const EXPIRED = { hasPaidAccess: false, planStatus: "expired" };

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  ads = await import("@/lib/ads/adsStore");
});

describe("image validation is magic-bytes + size, nothing else", () => {
  it("accepts the four types by their bytes and flags the animated-capable ones", () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);
    const gif = Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.alloc(8)]);
    const webp = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.alloc(4), Buffer.from("WEBP", "ascii"), Buffer.alloc(4)]);
    for (const [buf, ext, animated] of [
      [png, "png", false],
      [jpg, "jpg", false],
      [gif, "gif", true],
      [webp, "webp", true],
    ] as const) {
      const verdict = ads.validateAdImage(buf);
      assert.equal(verdict.ok, true);
      if (verdict.ok) {
        assert.equal(verdict.ext, ext);
        assert.equal(verdict.animatedCapable, animated);
      }
    }
  });

  it("rejects a wrong type whatever it claims to be, and an oversize file", () => {
    const evil = Buffer.from("<script>alert(1)</script> pretending to be photo.png");
    const verdict = ads.validateAdImage(evil);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.equal(verdict.reason, "unsupported_type");

    const fat = Buffer.alloc(ads.AD_IMAGE_MAX_BYTES + 1, 0x89);
    const tooBig = ads.validateAdImage(fat);
    assert.equal(tooBig.ok, false);
    if (!tooBig.ok) assert.equal(tooBig.reason, "too_large");
  });
});

describe("targeting, window, dismissal", () => {
  it("audience follows account state exactly", async () => {
    const userId = await makeUser();
    const subOnly = await ads.createAd({
      slides: [{ text: "للمشتركين" }],
      audience: "subscribers",
      createdBy: 1,
    });
    const trialOnly = await ads.createAd({
      slides: [{ text: "للتجربة" }],
      audience: "trial",
      createdBy: 1,
    });

    const asSub = await ads.eligibleAdFor(userId, SUB);
    assert.equal(asSub?.id, subOnly, "a subscriber sees the subscriber ad");

    const asTrial = await ads.eligibleAdFor(userId, TRIAL);
    assert.equal(asTrial?.id, trialOnly, "a trial account sees the trial ad");

    const asExpired = await ads.eligibleAdFor(userId, EXPIRED);
    assert.notEqual(asExpired?.id, subOnly, "an expired account never sees subscriber ads");
    assert.notEqual(asExpired?.id, trialOnly, "…nor trial-only ads");

    await ads.deleteAd(subOnly);
    await ads.deleteAd(trialOnly);
  });

  it("the window bounds visibility — an ended ad is invisible while its row exists", async () => {
    const userId = await makeUser();
    const now = Date.now();
    const ended = await ads.createAd({
      slides: [{ text: "انتهى" }],
      audience: "all",
      startsAt: now - 10 * 86_400_000,
      endsAt: now - 86_400_000,
      createdBy: 1,
    });
    const future = await ads.createAd({
      slides: [{ text: "لاحقاً" }],
      audience: "all",
      startsAt: now + 86_400_000,
      endsAt: now + 10 * 86_400_000,
      createdBy: 1,
    });
    assert.equal(await ads.eligibleAdFor(userId, SUB), null, "ended + not-started are both invisible");

    const live = await ads.createAd({
      slides: [{ text: "سارٍ" }],
      audience: "all",
      startsAt: now - 1000,
      endsAt: now + 86_400_000,
      createdBy: 1,
    });
    assert.equal((await ads.eligibleAdFor(userId, SUB))?.id, live);
    for (const id of [ended, future, live]) await ads.deleteAd(id);
  });

  it("a dismissal is permanent per user and never leaks to another user", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const adId = await ads.createAd({
      slides: [{ text: "مرة واحدة" }],
      audience: "all",
      createdBy: 1,
    });
    assert.equal((await ads.eligibleAdFor(alice, SUB))?.id, adId);
    await ads.dismissAd(alice, adId);
    assert.equal(await ads.eligibleAdFor(alice, SUB), null, "closed → never returns");
    assert.equal((await ads.eligibleAdFor(bob, SUB))?.id, adId, "bob still sees it");
    await ads.dismissAd(alice, adId); // idempotent
    await ads.deleteAd(adId);
  });

  it("an instant disable hides the ad immediately", async () => {
    const userId = await makeUser();
    const adId = await ads.createAd({
      slides: [{ text: "سيُعطَّل" }],
      audience: "all",
      createdBy: 1,
    });
    assert.equal((await ads.eligibleAdFor(userId, SUB))?.id, adId);
    await ads.updateAd(adId, { active: false });
    assert.equal(await ads.eligibleAdFor(userId, SUB), null);
    await ads.deleteAd(adId);
  });
});

describe("the ad UI is structurally safe", () => {
  const SRC = path.join(process.cwd(), "src");

  it("renders text as TEXT nodes and never trusts markup", () => {
    const modal = readFileSync(path.join(SRC, "components/ads/AdModal.tsx"), "utf8");
    assert.doesNotMatch(modal, /dangerouslySetInnerHTML/);
    // Reduced motion holds animated images behind an explicit action.
    assert.match(modal, /prefers-reduced-motion/);
    assert.match(modal, /ads\.play_animation/);
    // One per session; the refusal modal always outranks an ad.
    assert.match(modal, /sessionStorage/);
    assert.match(modal, /data-refusal-modal/);
    // Images are contained — they can never break the layout.
    assert.match(modal, /max-w-full/);
    const refusal = readFileSync(
      path.join(SRC, "components/billing/BillingRefusalModal.tsx"),
      "utf8",
    );
    assert.match(refusal, /data-refusal-modal/, "the priority marker exists on the refusal modal");
  });
});
