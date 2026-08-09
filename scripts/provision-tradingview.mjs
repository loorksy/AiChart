#!/usr/bin/env node
/**
 * Securely provision the proprietary TradingView Advanced Charts library for CI
 * and deployment. The library is LICENSED and gitignored — it is never committed
 * to this repository. This script fetches it from a private, authenticated
 * source configured entirely through secrets, verifies the expected files exist,
 * and fails early with a clear message when they are missing.
 *
 * Required secrets (set in CI / the deploy environment, NEVER printed here):
 *   TRADINGVIEW_LIBRARY_URL    Authenticated URL of the licensed archive
 *                              (.tgz/.tar.gz or .zip). May be a private registry,
 *                              signed object-storage URL, or licensed source.
 *   TRADINGVIEW_LIBRARY_TOKEN  (optional) Bearer token sent as Authorization
 *                              when the URL itself is not pre-signed.
 *
 * Layout produced (both are gitignored):
 *   src/vendor/tradingview/charting_library/   → TS module + typings (typecheck/build)
 *   public/charting_library/                   → runtime JS served to the browser
 *
 * Exit codes: 0 on success (or when already provisioned), non-zero with a clear
 * reason otherwise. Secret values are never logged.
 */
import { existsSync, mkdirSync, rmSync, createWriteStream } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_DIR = join(webRoot, "src", "vendor", "tradingview", "charting_library");
const PUBLIC_DIR = join(webRoot, "public", "charting_library");

// A representative file in each location proves a real extraction (not an empty
// dir). Typecheck/build need the typings; the browser needs the standalone JS.
const REQUIRED = [
  { path: join(VENDOR_DIR, "charting_library.d.ts"), what: "typings" },
  { path: join(PUBLIC_DIR, "charting_library.standalone.js"), what: "runtime bundle" },
];

function alreadyProvisioned() {
  return REQUIRED.every((r) => existsSync(r.path));
}

function fail(msg) {
  console.error(`\n✗ TradingView library not provisioned.\n  ${msg}\n`);
  process.exit(1);
}

async function download(url, token, dest) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok || !res.body) {
    // Never echo the URL/token — only the status class.
    fail(`Download failed with HTTP ${res.status}. Check the licensed source and token.`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function extract(archive, into) {
  mkdirSync(into, { recursive: true });
  const isZip = archive.endsWith(".zip");
  const cmd = isZip ? "unzip" : "tar";
  const args = isZip ? ["-o", archive, "-d", into] : ["-xzf", archive, "-C", into];
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) fail(`Failed to extract the archive with '${cmd}'.`);
}

async function main() {
  if (alreadyProvisioned()) {
    console.log("✓ TradingView library already present — skipping download.");
    return;
  }

  const url = process.env.TRADINGVIEW_LIBRARY_URL?.trim();
  const token = process.env.TRADINGVIEW_LIBRARY_TOKEN?.trim();

  if (!url) {
    fail(
      "Set TRADINGVIEW_LIBRARY_URL (and optionally TRADINGVIEW_LIBRARY_TOKEN) to the\n" +
        "  licensed archive. The proprietary library is never committed to git.",
    );
  }

  const staging = join(tmpdir(), `tv-lib-${Date.now()}`);
  mkdirSync(staging, { recursive: true });
  const archive = join(staging, url.endsWith(".zip") ? "lib.zip" : "lib.tgz");

  console.log("→ Fetching licensed TradingView library from the configured source…");
  await download(url, token, archive);
  extract(archive, staging);

  // The archive is expected to contain `charting_library/` (typings + runtime).
  // Place typings under the vendor path and the runtime under public/.
  const extractedLib = findDir(staging, "charting_library") ?? staging;
  mkdirSync(dirname(VENDOR_DIR), { recursive: true });
  rmSync(VENDOR_DIR, { recursive: true, force: true });
  rmSync(PUBLIC_DIR, { recursive: true, force: true });
  copyDir(extractedLib, VENDOR_DIR);
  copyDir(extractedLib, PUBLIC_DIR);

  const missing = REQUIRED.filter((r) => !existsSync(r.path));
  if (missing.length) {
    fail(
      "Archive extracted but expected files are missing:\n  " +
        missing.map((m) => `${m.what}: ${m.path.replace(webRoot, ".")}`).join("\n  "),
    );
  }
  rmSync(staging, { recursive: true, force: true });
  console.log("✓ TradingView library provisioned (vendor typings + public runtime).");
}

function findDir(root, name) {
  const r = spawnSync("find", [root, "-type", "d", "-name", name, "-print", "-quit"], {
    encoding: "utf8",
  });
  const p = r.stdout.trim().split("\n")[0];
  return p && existsSync(p) ? p : null;
}

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  const r = spawnSync("cp", ["-R", `${from}/.`, to], { stdio: "inherit" });
  if (r.status !== 0) fail(`Failed to copy library files into ${to.replace(webRoot, ".")}.`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
