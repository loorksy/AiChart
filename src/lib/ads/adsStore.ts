import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execute, insertReturningId, query, queryOne } from "@/lib/db";

/**
 * Ads (billing v3 companion) — admin-authored slides shown to signed-in
 * users, targeted by ACCOUNT STATE and bounded by a date window.
 *
 * The safety posture is structural, not a filter:
 *  - slide TEXT is stored as plain text and rendered as TEXT nodes — there
 *    is no HTML path from the admin to the user's DOM at all;
 *  - images are accepted only when their MAGIC BYTES say png/jpeg/gif/webp
 *    and they fit the size cap — extension and Content-Type are ignored;
 *  - the eligibility query owns targeting, the window, and per-user
 *    dismissal, so every surface asks one question and cannot drift.
 */

export type AdAudience = "all" | "subscribers" | "non_subscribers" | "trial";

export interface AdSlide {
  image_path?: string;
  text?: string;
}

export interface AdRow {
  id: number;
  slides_json: string;
  audience: AdAudience;
  active: number;
  starts_at: number | null;
  ends_at: number | null;
  created_by: number | null;
  created_at: number;
  updated_at: number;
}

/** Structural upload bounds — a transport cap, not a price. */
export const AD_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

const MAGIC: Array<{ ext: string; test: (b: Buffer) => boolean }> = [
  { ext: "png", test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: "jpg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "gif", test: (b) => b.length > 6 && b.subarray(0, 4).toString("ascii") === "GIF8" },
  {
    ext: "webp",
    test: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

/** Types the platform accepts, for a picker filter that cannot drift. */
export const AD_IMAGE_ACCEPTED = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

/**
 * Is this file actually ANIMATED — as opposed to merely being of a format
 * that could be?
 *
 * The old flag answered the second question and was named as though it
 * answered the first: every WebP reported "animated", every APNG reported
 * "still", and the public read path re-derived the same guess from the file
 * extension. The operator could not tell, before publishing, whether the
 * thing they uploaded would move.
 *
 * Read from the bytes, per format:
 *   - GIF   — more than one Image Descriptor (0x2C) block, which is what a
 *             multi-frame GIF is; the NETSCAPE2.0 loop extension confirms it.
 *   - WebP  — an ANIM/ANMF chunk (VP8X animation bit set).
 *   - PNG   — an `acTL` chunk before the first `IDAT`, i.e. APNG.
 */
function detectAnimated(bytes: Buffer, ext: string): boolean {
  try {
    if (ext === "gif") {
      if (bytes.includes(Buffer.from("NETSCAPE2.0", "ascii"))) return true;
      let frames = 0;
      // Scan for image descriptors; two or more means it animates.
      for (let i = 13; i < bytes.length && frames < 2; i += 1) {
        if (bytes[i] === 0x2c) frames += 1;
      }
      return frames >= 2;
    }
    if (ext === "webp") {
      return (
        bytes.includes(Buffer.from("ANMF", "ascii")) ||
        bytes.includes(Buffer.from("ANIM", "ascii"))
      );
    }
    if (ext === "png") {
      const acTL = bytes.indexOf(Buffer.from("acTL", "ascii"));
      const idat = bytes.indexOf(Buffer.from("IDAT", "ascii"));
      return acTL !== -1 && (idat === -1 || acTL < idat);
    }
  } catch {
    // A malformed file is not an animated one.
  }
  return false;
}

export type AdImageValidation =
  | {
      ok: true;
      ext: string;
      /** The format COULD animate. */
      animatedCapable: boolean;
      /** This file actually DOES animate — read from its bytes. */
      animated: boolean;
      bytes: number;
    }
  | { ok: false; reason: "too_large" | "unsupported_type" };

/** Magic-byte + size validation. Extension and Content-Type are ignored. */
export function validateAdImage(bytes: Buffer): AdImageValidation {
  if (bytes.length > AD_IMAGE_MAX_BYTES) return { ok: false, reason: "too_large" };
  for (const magic of MAGIC) {
    if (magic.test(bytes)) {
      return {
        ok: true,
        ext: magic.ext,
        animatedCapable: magic.ext === "gif" || magic.ext === "webp" || magic.ext === "png",
        animated: detectAnimated(bytes, magic.ext),
        bytes: bytes.length,
      };
    }
  }
  return { ok: false, reason: "unsupported_type" };
}

export function adsUploadDir(): string {
  return path.join(process.cwd(), "data", "uploads", "ads");
}

/** Persist a validated image; returns the serving path (route-relative id). */
export function storeAdImage(bytes: Buffer, ext: string): string {
  const name = `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}.${ext}`;
  mkdirSync(adsUploadDir(), { recursive: true });
  writeFileSync(path.join(adsUploadDir(), name), bytes);
  return name;
}

function sanitizeSlides(raw: AdSlide[]): AdSlide[] {
  return raw
    .map((slide) => ({
      // Plain text only — length-bounded; rendering uses text nodes.
      ...(slide.text ? { text: String(slide.text).slice(0, 2000) } : {}),
      ...(slide.image_path ? { image_path: path.basename(String(slide.image_path)) } : {}),
    }))
    .filter((slide) => slide.text || slide.image_path)
    .slice(0, 10);
}

export async function createAd(input: {
  slides: AdSlide[];
  audience: AdAudience;
  active?: boolean;
  startsAt?: number | null;
  endsAt?: number | null;
  createdBy: number;
}): Promise<number> {
  const slides = sanitizeSlides(input.slides);
  if (slides.length === 0) throw new Error("an ad needs at least one slide with text or an image");
  const now = Date.now();
  return insertReturningId(
    `INSERT INTO ads (slides_json, audience, active, starts_at, ends_at, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      JSON.stringify(slides),
      input.audience,
      input.active === false ? 0 : 1,
      input.startsAt ?? null,
      input.endsAt ?? null,
      input.createdBy,
      now,
      now,
    ],
  );
}

export async function updateAd(
  id: number,
  patch: {
    active?: boolean;
    audience?: AdAudience;
    startsAt?: number | null;
    endsAt?: number | null;
    slides?: AdSlide[];
  },
): Promise<void> {
  const row = await queryOne<AdRow>("SELECT * FROM ads WHERE id = ?", [id]);
  if (!row) throw new Error("ad not found");
  const slides = patch.slides ? sanitizeSlides(patch.slides) : null;
  await execute(
    `UPDATE ads SET slides_json = ?, audience = ?, active = ?, starts_at = ?, ends_at = ?, updated_at = ?
      WHERE id = ?`,
    [
      slides ? JSON.stringify(slides) : row.slides_json,
      patch.audience ?? row.audience,
      patch.active == null ? row.active : patch.active ? 1 : 0,
      patch.startsAt === undefined ? row.starts_at : patch.startsAt,
      patch.endsAt === undefined ? row.ends_at : patch.endsAt,
      Date.now(),
      id,
    ],
  );
}

export async function deleteAd(id: number): Promise<void> {
  await execute("DELETE FROM ads WHERE id = ?", [id]);
}

export async function listAds(): Promise<AdRow[]> {
  return query<AdRow>("SELECT * FROM ads ORDER BY id DESC");
}

/** The audience groups an account state belongs to. */
export function audiencesFor(state: { hasPaidAccess: boolean; planStatus: string }): AdAudience[] {
  const groups: AdAudience[] = ["all"];
  if (state.hasPaidAccess) groups.push("subscribers");
  else {
    groups.push("non_subscribers");
    if (state.planStatus === "trial") groups.push("trial");
  }
  return groups;
}

/**
 * The one eligible ad for this user right now: active, inside its window,
 * targeted at a group the account belongs to, and never one this user
 * dismissed. Newest first; one at a time — the session cap is the client's.
 */
export async function eligibleAdFor(
  userId: number,
  state: { hasPaidAccess: boolean; planStatus: string },
  now = Date.now(),
): Promise<(Omit<AdRow, "slides_json"> & { slides: AdSlide[] }) | null> {
  const groups = audiencesFor(state);
  const placeholders = groups.map(() => "?").join(",");
  const row = await queryOne<AdRow>(
    `SELECT a.* FROM ads a
      WHERE a.active = 1
        AND (a.starts_at IS NULL OR a.starts_at <= ?)
        AND (a.ends_at IS NULL OR a.ends_at > ?)
        AND a.audience IN (${placeholders})
        AND NOT EXISTS (
          SELECT 1 FROM ad_dismissals d WHERE d.ad_id = a.id AND d.user_id = ?
        )
      ORDER BY a.id DESC LIMIT 1`,
    [now, now, ...groups, userId],
  );
  if (!row) return null;
  let slides: AdSlide[] = [];
  try {
    const parsed = JSON.parse(row.slides_json) as unknown;
    if (Array.isArray(parsed)) slides = sanitizeSlides(parsed as AdSlide[]);
  } catch {
    return null;
  }
  if (slides.length === 0) return null;
  const { slides_json: _dropped, ...rest } = row;
  return { ...rest, slides };
}

/** The X button: persisted per (user, ad) — this ad never comes back. */
export async function dismissAd(userId: number, adId: number): Promise<void> {
  const done = await execute(
    "UPDATE ad_dismissals SET dismissed_at = ? WHERE user_id = ? AND ad_id = ?",
    [Date.now(), userId, adId],
  );
  if (!done.changes) {
    await execute(
      "INSERT INTO ad_dismissals (user_id, ad_id, dismissed_at) VALUES (?, ?, ?)",
      [userId, adId, Date.now()],
    ).catch(() => {});
  }
}
