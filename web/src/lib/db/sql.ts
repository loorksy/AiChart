import type { DbBackend } from "./types";

/** SQL fragment for current timestamp (compatible with both backends). */
export function sqlNow(backend: DbBackend): string {
  return backend === "postgres" ? "NOW()" : "datetime('now')";
}

/** Adapt SQLite-oriented SQL for PostgreSQL. */
export function adaptSql(sql: string, backend: DbBackend): string {
  if (backend === "sqlite") return sql;

  let s = sql;
  s = s.replace(/datetime\s*\(\s*'now'\s*\)/gi, "NOW()");
  s = s.replace(
    /datetime\s*\(\s*'now'\s*,\s*'([^']+)'\s*\)/gi,
    (_m, interval: string) => {
      const normalized = interval.trim().replace(/^-/, "");
      const sign = interval.trim().startsWith("-") ? "-" : "+";
      return `NOW() ${sign} INTERVAL '${normalized}'`;
    },
  );
  s = s.replace(
    /datetime\s*\(\s*'now'\s*,\s*\?\s*\)/gi,
    "NOW() + ?::interval",
  );
  s = s.replace(
    /date\s*\(\s*closed_at\s*\)\s*=\s*date\s*\(\s*'now'\s*\)/gi,
    "closed_at::date = CURRENT_DATE",
  );
  s = s.replace(/ON CONFLICT\s*\(([^)]+)\)/gi, "ON CONFLICT ($1)");
  for (const col of [
    "plain",
    "archived",
    "send_screenshot",
    "kill_switch",
    "onboarding_done",
    "can_execute",
  ]) {
    s = s.replace(new RegExp(`\\b${col}\\s*=\\s*1\\b`, "gi"), `${col} IS TRUE`);
    s = s.replace(new RegExp(`\\b${col}\\s*=\\s*0\\b`, "gi"), `${col} IS FALSE`);
  }
  let i = 0;
  s = s.replace(/\?/g, () => `$${++i}`);
  return s;
}

/** Convert pg boolean / bigint fields to shapes expected by existing types. */
export function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "boolean") {
      out[k] = v ? 1 : 0;
    } else if (typeof v === "bigint") {
      out[k] = Number(v);
    } else if (v instanceof Date) {
      out[k] = v.toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}
