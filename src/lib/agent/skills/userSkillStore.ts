/**
 * Per-user custom agent skills, stored in the database (not the filesystem
 * catalogue). A user skill is one SKILL.md document; on save the frontmatter
 * is parsed and normalized with hard safety rails:
 *  - trust is ALWAYS "user" (self-promotion in frontmatter is ignored)
 *  - riskLevel is capped at "analysis" — user skills can never be execution
 *    skills, and the selector additionally refuses execution skills anyway
 *  - name must match the catalogue's slug rules; content is size-capped
 * Skills are advisory prompt guidance only; they grant no permissions.
 */
import { execute, query, queryOne } from "@/lib/db";
import { parseSkillDocument } from "./frontmatter";
import type { AgentSkillMetadata, AgentSkillRiskLevel } from "./types";

export const MAX_USER_SKILL_BYTES = 100_000;
export const MAX_USER_SKILLS = 12;

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

export interface UserSkillRecord {
  name: string;
  description: string;
  version: string;
  riskLevel: AgentSkillRiskLevel;
  tags: string[];
  enabled: boolean;
  sizeBytes: number;
  updatedAt: string | null;
}

export interface UserSkillWithContent {
  metadata: AgentSkillMetadata;
  content: string;
}

interface Row {
  name: string;
  content: string;
  enabled: number;
  updated_at: string | null;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

const strList = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : undefined;

/** Parse + normalize one stored document into selection metadata. */
export function userSkillMetadata(
  name: string,
  content: string,
  enabled: boolean,
): AgentSkillMetadata {
  const { frontmatter } = parseSkillDocument(content);
  const risk = str(frontmatter.riskLevel);
  return {
    name,
    version: str(frontmatter.version) ?? "1.0.0",
    description: str(frontmatter.description) ?? name,
    category: str(frontmatter.category) ?? "trading",
    enabled,
    // Hard rails — regardless of what the uploaded frontmatter claims.
    trust: "user",
    riskLevel: risk === "read_only" ? "read_only" : "analysis",
    supportedLocales: strList(frontmatter.supportedLocales) as
      | Array<"ar" | "en">
      | undefined,
    allowedMarkets: strList(frontmatter.allowedMarkets),
    requiredTools: undefined, // never gate selection on tools the user names
    tags: strList(frontmatter.tags),
  };
}

/** Validate + upsert a skill document. Returns the stored record. */
export async function saveUserSkill(
  userId: number,
  content: string,
): Promise<UserSkillRecord> {
  const trimmed = content.replace(/^﻿/, "");
  if (Buffer.byteLength(trimmed, "utf8") > MAX_USER_SKILL_BYTES) {
    throw new Error(`حجم الملف يتجاوز الحد (${MAX_USER_SKILL_BYTES / 1000}KB).`);
  }
  const { frontmatter, body } = parseSkillDocument(trimmed);
  const name = str(frontmatter.name);
  if (!name || !NAME_PATTERN.test(name)) {
    throw new Error(
      'الواجهة الأمامية للملف يجب أن تتضمن name صالحاً (أحرف لاتينية صغيرة وأرقام وشرطات، مثل: "my-strategy").',
    );
  }
  if (!body.trim()) {
    throw new Error("محتوى المهارة فارغ — أضف التعليمات بعد الواجهة الأمامية.");
  }
  if (str(frontmatter.riskLevel) === "execution") {
    throw new Error("مهارات التنفيذ غير مسموحة للمستخدمين — استخدم riskLevel: analysis.");
  }
  const existing = await queryOne<{ count: number }>(
    "SELECT COUNT(*) AS count FROM user_agent_skills WHERE user_id = ? AND name != ?",
    [userId, name],
  );
  if (Number(existing?.count ?? 0) >= MAX_USER_SKILLS) {
    throw new Error(`الحد الأقصى ${MAX_USER_SKILLS} مهارة لكل مستخدم.`);
  }

  const updated = await execute(
    `UPDATE user_agent_skills SET content = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND name = ?`,
    [trimmed, userId, name],
  );
  if (updated.changes === 0) {
    await execute(
      `INSERT INTO user_agent_skills (user_id, name, content, enabled) VALUES (?,?,?,1)`,
      [userId, name, trimmed],
    );
  }
  const row = await queryOne<Row>(
    "SELECT name, content, enabled, updated_at FROM user_agent_skills WHERE user_id = ? AND name = ?",
    [userId, name],
  );
  return toRecord(row!);
}

function toRecord(row: Row): UserSkillRecord {
  const meta = userSkillMetadata(row.name, row.content, row.enabled === 1);
  return {
    name: meta.name,
    description: meta.description,
    version: meta.version,
    riskLevel: meta.riskLevel,
    tags: meta.tags ?? [],
    enabled: row.enabled === 1,
    sizeBytes: Buffer.byteLength(row.content, "utf8"),
    updatedAt: row.updated_at,
  };
}

export async function listUserSkills(userId: number): Promise<UserSkillRecord[]> {
  const rows = await query<Row>(
    "SELECT name, content, enabled, updated_at FROM user_agent_skills WHERE user_id = ? ORDER BY name",
    [userId],
  );
  return rows.map(toRecord);
}

export async function getUserSkillContent(
  userId: number,
  name: string,
): Promise<string | null> {
  const row = await queryOne<{ content: string }>(
    "SELECT content FROM user_agent_skills WHERE user_id = ? AND name = ?",
    [userId, name],
  );
  return row?.content ?? null;
}

export async function deleteUserSkill(userId: number, name: string): Promise<boolean> {
  const res = await execute(
    "DELETE FROM user_agent_skills WHERE user_id = ? AND name = ?",
    [userId, name],
  );
  return res.changes > 0;
}

export async function setUserSkillEnabled(
  userId: number,
  name: string,
  enabled: boolean,
): Promise<boolean> {
  const res = await execute(
    "UPDATE user_agent_skills SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND name = ?",
    [enabled ? 1 : 0, userId, name],
  );
  return res.changes > 0;
}

/** Enabled skills with content — the orchestrator's per-request injection. */
export async function enabledUserSkills(
  userId: number,
): Promise<UserSkillWithContent[]> {
  const rows = await query<Row>(
    "SELECT name, content, enabled, updated_at FROM user_agent_skills WHERE user_id = ? AND enabled = 1 ORDER BY name",
    [userId],
  );
  return rows.map((row) => ({
    metadata: userSkillMetadata(row.name, row.content, true),
    content: parseSkillDocument(row.content).body,
  }));
}
