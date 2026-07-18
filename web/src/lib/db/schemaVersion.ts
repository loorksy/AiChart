/**
 * Canonical database schema version for AiChart.
 *
 * This is the single source of truth used by:
 * - PostgreSQL bootstrap / migrate (`pg.ts`)
 * - SQLite bootstrap / migrate (`sqlite.ts`)
 * - PostgreSQL release validator (`scripts/validate-postgres-release.ts`)
 *
 * Do not redefine this string elsewhere. The schema-version contract test
 * fails if runtime drivers or the release validator drift from this export.
 */
export const AICHART_SCHEMA_VERSION =
  "2026-07-18-nav-admin-subscription-v1" as const;

export type AichartSchemaVersion = typeof AICHART_SCHEMA_VERSION;
