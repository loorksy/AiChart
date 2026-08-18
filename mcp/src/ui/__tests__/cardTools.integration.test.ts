/**
 * Integration audit: every card-linked tool → ui:// URI → resources/read.
 * Run: npm run build && npm run test:catalog
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { BridgeClient } from "../../bridge/client.js";
import { loadConfig } from "../../config.js";
import { createAiChartMcpServer } from "../../server/mcpServer.js";
import { TOOL_CATALOG } from "../../tools/schemas/index.js";
import type { ToolDefinition } from "../../tools/schemas/types.js";
import { appsUri, liveChartCspOrigins, widgetHtmlByPublicPath } from "../index.js";
import { WIDGETS } from "../widgets.js";

// This is a self-contained in-memory audit (linked client/server transport). It
// never calls the live bridge, so run in unauthenticated mode — otherwise
// loadConfig() would require a production AICHART_SERVICE_TOKEN that this test
// does not use. Set BEFORE loadConfig() reads it.
process.env.MCP_AUTH_MODE = "none";

const CARD_TOOLS = TOOL_CATALOG.filter((t: ToolDefinition) => t.ui?.widget);

async function withMcpClient<T>(
  fn: (client: Client, listedUris: Set<string>) => Promise<T>,
): Promise<T> {
  const cfg = loadConfig();
  cfg.authMode = "none";
  const bridge = BridgeClient.forUser(
    cfg,
    process.env.AICHART_AGENT_USER_EMAIL ?? "probe@test.local",
  );
  const server = createAiChartMcpServer(bridge);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "card-audit", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const listed = await client.listResources();
  const uris = new Set(listed.resources.map((r) => r.uri));
  try {
    return await fn(client, uris);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("MCP card tools integration audit", () => {
  it("audits all card tools: URI registered + resources/read inline HTML", async () => {
    const rows: string[] = [];
    await withMcpClient(async (client, listedUris) => {
      for (const tool of CARD_TOOLS) {
        const widget = tool.ui!.widget;
        assert.ok(WIDGETS[widget], `${tool.name} → missing widget ${widget}`);
        const uri = appsUri(widget);
        const registered = listedUris.has(uri);
        let status = registered ? "ok" : "MISSING";
        let mime = "";
        let bytes = 0;
        if (registered) {
          try {
            const read = await client.readResource({ uri });
            const item = read.contents[0]!;
            mime = item.mimeType ?? "";
            const text = "text" in item ? item.text : "";
            bytes = (text || "").length;
            const htmlOk =
              mime.includes("text/html") &&
              bytes > 100 &&
              !Boolean("uri" in item && item.uri && !text);
            if (!htmlOk) status = "BAD_BODY";
            assert.ok(htmlOk, `${tool.name} read body invalid mime=${mime} bytes=${bytes}`);
            assert.equal(
              item.mimeType,
              RESOURCE_MIME_TYPE,
              `${tool.name} must use MCP Apps MIME`,
            );
            if (widget === "live-chart" || widget === "chart-drawn") {
              const origins = liveChartCspOrigins();
              const contentsMeta = item._meta as {
                ui?: {
                  csp?: {
                    frameDomains?: string[];
                    connectDomains?: string[];
                    resourceDomains?: string[];
                  };
                };
              };
              assert.deepEqual(
                contentsMeta.ui?.csp?.frameDomains,
                origins,
                `${tool.name} resources/read must declare frameDomains`,
              );
              assert.deepEqual(contentsMeta.ui?.csp?.connectDomains, origins);
              assert.deepEqual(contentsMeta.ui?.csp?.resourceDomains, origins);
            }
          } catch (e) {
            status = `READ_FAIL:${e instanceof Error ? e.message : e}`;
            assert.fail(`${tool.name} resources/read failed: ${status}`);
          }
        } else {
          assert.fail(`${tool.name} URI not registered: ${uri}`);
        }
        rows.push(`${tool.name}\turi\t${registered ? "y" : "n"}\t${status}\t${mime}\t${bytes}`);
      }
    });
    // eslint-disable-next-line no-console
    console.log("\n=== card tool audit ===\n" + rows.join("\n"));
  });

  it("public /mcp-ui path resolves every registered widget", () => {
    for (const name of Object.keys(WIDGETS)) {
      const path = appsUri(name).replace(/^ui:\/\/aichart\//, "");
      const hit = widgetHtmlByPublicPath(path);
      assert.ok(hit, `public path missing for ${name} (${path})`);
      assert.ok(hit.html.length > 200);
      // Self-contained shells (inline theme+runtime): sandbox blocks external
      // assets, so everything ships in the HTML — keep a sanity upper bound.
      assert.ok(hit.html.length < 80000, `${name} shell too large (${hit.html.length}b)`);
      assert.ok(hit.mimeType.includes("text/html"));
      assert.ok(hit.html.includes("window.AIC"), `${name} must inline shared runtime`);
    }
  });
});
