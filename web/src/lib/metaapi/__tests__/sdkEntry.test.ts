import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * metaapi.cloud-sdk maps its root `import` condition to dists/esm-web, a
 * browser bundle that reads `window` at module scope, and keeps the Node build
 * behind `require`. A dynamic import() of the bare name from server code
 * therefore resolves to the web build and throws
 *
 *   ReferenceError: window is not defined
 *
 * the first time anyone actually links an account — which is why it survived
 * every build, every typecheck and the whole unit suite. Nothing type-level can
 * see it: the export map is a runtime resolution, not a type.
 *
 * So this test loads the module for real.
 */

const CLIENT = path.join(import.meta.dirname, "..", "client.ts");

test("the SDK is imported through the Node subpath", () => {
  const src = readFileSync(CLIENT, "utf8");
  assert.match(
    src,
    /import\(\s*["']metaapi\.cloud-sdk\/esm-node["']\s*\)/,
    "client.ts must import the Node build explicitly",
  );
  assert.ok(
    !/import\(\s*["']metaapi\.cloud-sdk["']\s*\)/.test(src),
    "the bare specifier resolves to the browser bundle on the server",
  );
});

test("that subpath actually loads under Node and yields the class", async () => {
  const mod = await import("metaapi.cloud-sdk/esm-node");
  assert.equal(
    typeof mod.default,
    "function",
    "default export should be the MetaApi constructor itself",
  );
  assert.equal((mod.default as { name?: string }).name, "MetaApi");
});

test("the bare specifier still fails, so the subpath is load-bearing", async () => {
  // Pins the reason for the subpath. If a future SDK release fixes its export
  // map this flips, and the extra indirection can be reconsidered on purpose
  // rather than being cargo-culted forever.
  await assert.rejects(
    () => import("metaapi.cloud-sdk"),
    /window is not defined/,
    "if this passes, the upstream export map changed — re-evaluate the subpath",
  );
});
