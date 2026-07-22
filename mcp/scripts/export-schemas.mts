#!/usr/bin/env node
/**
 * Export MCP tool JSON Schemas from TOOL_CATALOG.
 * Usage: tsx scripts/export-schemas.mts [--check]
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { MCP_SERVER_VERSION } from "../src/tools/registry.js";
import { TOOL_CATALOG } from "../src/tools/schemas/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "schemas");
const TOOLS_DIR = join(OUT_DIR, "tools");
const MANIFEST_PATH = join(OUT_DIR, "manifest.json");
const checkMode = process.argv.includes("--check");

function buildManifest() {
  return {
    mcpServerVersion: MCP_SERVER_VERSION,
    exportedAt: new Date().toISOString(),
    toolCount: TOOL_CATALOG.length,
    tools: TOOL_CATALOG.map((t) => ({
      name: t.name,
      domain: t.domain,
      description: t.description,
      annotations: t.annotations,
    })),
  };
}

function exportSchemas(targetDir: string) {
  mkdirSync(join(targetDir, "tools"), { recursive: true });
  writeFileSync(
    join(targetDir, "manifest.json"),
    `${JSON.stringify(buildManifest(), null, 2)}\n`,
    "utf8",
  );

  for (const tool of TOOL_CATALOG) {
    const schema = z.toJSONSchema(z.object(tool.inputSchema));
    writeFileSync(
      join(targetDir, "tools", `${tool.name}.json`),
      `${JSON.stringify(schema, null, 2)}\n`,
      "utf8",
    );
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Manifest includes exportedAt (volatile) — exclude from CI drift check. */
function manifestForCheck(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const { exportedAt: _, ...rest } = raw as Record<string, unknown>;
  return rest;
}

function checkSchemas(): boolean {
  const tmp = join(OUT_DIR, ".tmp-check");
  rmSync(tmp, { recursive: true, force: true });
  exportSchemas(tmp);

  let ok = true;
  const expectedManifest = manifestForCheck(readJson(MANIFEST_PATH));
  const actualManifest = manifestForCheck(readJson(join(tmp, "manifest.json")));
  if (!deepEqual(expectedManifest, actualManifest)) {
    console.error("manifest.json drift — run npm run schemas:export");
    ok = false;
  }

  for (const tool of TOOL_CATALOG) {
    const expectedPath = join(TOOLS_DIR, `${tool.name}.json`);
    const actualPath = join(tmp, "tools", `${tool.name}.json`);
    try {
      if (!deepEqual(readJson(expectedPath), readJson(actualPath))) {
        console.error(`schema drift: ${tool.name} — run npm run schemas:export`);
        ok = false;
      }
    } catch {
      console.error(`missing schema file: ${tool.name}.json`);
      ok = false;
    }
  }

  // Orphan detection: exported files for tools no longer in the catalog are
  // stale debris and must be removed (they previously masked removed tools).
  const catalogNames = new Set(TOOL_CATALOG.map((t) => `${t.name}.json`));
  for (const file of readdirSync(TOOLS_DIR)) {
    if (!catalogNames.has(file)) {
      console.error(`orphan schema file (tool not in catalog): ${file} — delete it`);
      ok = false;
    }
  }

  rmSync(tmp, { recursive: true, force: true });
  return ok;
}

if (checkMode) {
  if (!checkSchemas()) process.exit(1);
  console.log(`schemas:check OK (${TOOL_CATALOG.length} tools)`);
} else {
  exportSchemas(OUT_DIR);
  console.log(`Exported ${TOOL_CATALOG.length} schemas → ${OUT_DIR}`);
}
