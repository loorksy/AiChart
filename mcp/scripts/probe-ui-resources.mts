/**
 * Protocol-level probe: resources/list + resources/read for widget URIs.
 * Run: npm run build && node --import tsx mcp/scripts/probe-ui-resources.mts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BridgeClient } from "../src/bridge/client.js";
import { loadConfig } from "../src/config.js";
import { createAiChartMcpServer } from "../src/server/mcpServer.js";
import { TOOL_CATALOG } from "../src/tools/schemas/index.js";
import { appsUri } from "../src/ui/index.js";

const cfg = loadConfig();
cfg.authMode = "none";
const bridge = BridgeClient.forUser(cfg, process.env.AICHART_AGENT_USER_EMAIL ?? "probe@test.local");

const server = createAiChartMcpServer(bridge);
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "probe", version: "1.0.0" });

await server.connect(serverTransport);
await client.connect(clientTransport);

const listed = await client.listResources();
const uris = new Set(listed.resources.map((r) => r.uri));

console.log("=== resources/list (ui://*) ===");
for (const r of listed.resources.filter((x) => x.uri.startsWith("ui://"))) {
  console.log(r.uri, r.mimeType ?? "(no mime)");
}

console.log("\n=== tool URIs vs resources/list ===");
for (const tool of TOOL_CATALOG.filter((t) => t.ui?.widget)) {
  const uri = appsUri(tool.ui!.widget);
  const ok = uris.has(uri);
  console.log(`${ok ? "OK" : "MISSING"} ${tool.name} -> ${uri}`);
  if (!ok) continue;
  try {
    const read = await client.readResource({ uri });
    const item = read.contents[0];
    const text = "text" in item ? item.text : "";
    const blob = "blob" in item ? item.blob : "";
    console.log(
      `  read: mime=${item.mimeType} bytes=${(text || blob || "").length} external=${Boolean("uri" in item && item.uri && !text)}`,
    );
  } catch (e) {
    console.log(`  read FAILED: ${e instanceof Error ? e.message : e}`);
  }
}

await client.close();
await server.close();
