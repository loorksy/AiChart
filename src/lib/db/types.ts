export type DbBackend = "sqlite" | "postgres";

export interface ExecuteResult {
  changes: number;
  lastInsertId: number;
}

export interface DbRow {
  [column: string]: unknown;
}
