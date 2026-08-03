import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";
import { readWorkspaceFile } from "./helpers.js";
import { registerMarketTools } from "./market.js";
import { registerCoreTools } from "./core.js";
import { registerMt5Tools } from "./mt5.js";
import { registerChartsTools } from "./charts.js";
import { registerWidgets } from "../ui/index.js";
import { bootstrapText } from "../onboarding/bootstrap.js";
import { discoverSkills } from "../skills/catalog.js";
import { skillResourceStub } from "../skills/select.js";

export function registerAiChartTools(server: McpServer, bridge: BridgeClient) {
  // Bootstrap "first message" as an invocable prompt (slash command in hosts
  // that support prompts). Same canonical text as the copy panel + instructions.
  server.registerPrompt(
    "aichart_start",
    {
      title: "AiChart — bootstrap message (agent setup)",
      description:
        "Paste as the first message after connecting MCP: loads rules, discovers skills, summarizes account.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: bootstrapText() },
        },
      ],
    }),
  );

  // Non-skill workspace resources (full documents — not skills).
  const resources = [
    {
      id: "system",
      uri: "aichart://system",
      title: "AiChart System Constitution",
      description: "Canonical English agent instructions — identity, language policy, analysis, risk",
      file: "SYSTEM.md",
    },
    {
      id: "trading-rules",
      uri: "aichart://trading-rules",
      title: "AiChart Trading Rules (AGENTS.md)",
      description: "Agent operational and trading rules",
      file: "AGENTS.md",
    },
    {
      id: "execution-desk",
      uri: "aichart://execution-desk",
      title: "AiChart Execution Desk v3 (Disciplined)",
      description:
        "AI-led execution guidance with broker-verified sizing and technical authorization checks",
      file: "EXECUTION_DESK_V3.md",
    },
    {
      id: "heartbeat",
      uri: "aichart://heartbeat",
      title: "AiChart Heartbeat Spec",
      description: "Trade maintenance, monitoring, and automatic heartbeat details",
      file: "HEARTBEAT.md",
    },
    {
      id: "memory",
      uri: "aichart://memory",
      title: "AiChart Memory",
      description: "Persistent memory file for facts, lessons learned, and trades",
      file: "MEMORY.md",
    },
    {
      id: "soul",
      uri: "aichart://soul",
      title: "AiChart Soul Profile",
      description: "Agent expert persona, style, and principles profile",
      file: "SOUL.md",
    },
    {
      id: "user",
      uri: "aichart://user",
      title: "AiChart Operator Profile",
      description: "Human operator info and preferences profile",
      file: "USER.md",
    },
    {
      id: "agent-readme",
      uri: "aichart://agent-readme",
      title: "AiChart Agent README",
      description: "Agent documentation and technical structure guide",
      file: "../README.md",
    },
  ];

  for (const res of resources) {
    server.registerResource(
      res.id,
      res.uri,
      {
        title: res.title,
        description: res.description,
        mimeType: "text/markdown",
      },
      async () => ({
        contents: [
          {
            uri: res.uri,
            mimeType: "text/markdown",
            text: readWorkspaceFile(res.file, `# ${res.title}\n\nFile not found or empty.`),
          },
        ],
      }),
    );
  }

  // Skill catalogue resources: metadata stubs ONLY — driven by discoverSkills().
  // Full bodies are available exclusively via load_agent_skill.
  // Legacy URIs (aichart://trading-lexicon etc.) also return stubs — never bodies.
  const LEGACY_SKILL_URIS: Record<string, string> = {
    "trading-lexicon": "aichart://trading-lexicon",
    "trading-strategies": "aichart://trading-strategies",
    cards: "aichart://cards",
  };
  const { skills } = discoverSkills();
  for (const { metadata } of skills) {
    const stub = skillResourceStub(metadata);
    const canonicalUri = `aichart://skill/${metadata.name}`;
    server.registerResource(
      `skill-${metadata.name}`,
      canonicalUri,
      {
        title: `Skill catalogue: ${metadata.name}`,
        description: `Metadata only for ${metadata.name}. Not a loaded skill — use load_agent_skill.`,
        mimeType: "text/markdown",
      },
      async () => ({
        contents: [{ uri: canonicalUri, mimeType: "text/markdown", text: stub }],
      }),
    );
    const legacyUri = LEGACY_SKILL_URIS[metadata.name];
    if (legacyUri) {
      server.registerResource(
        metadata.name,
        legacyUri,
        {
          title: `Skill catalogue: ${metadata.name} (legacy URI)`,
          description: `Metadata only — not a loaded skill. Prefer load_agent_skill("${metadata.name}").`,
          mimeType: "text/markdown",
        },
        async () => ({
          contents: [{ uri: legacyUri, mimeType: "text/markdown", text: stub }],
        }),
      );
    }
  }

  registerCoreTools(server, bridge);
  registerMarketTools(server, bridge);
  registerMt5Tools(server, bridge);
  registerChartsTools(server, bridge);
  registerWidgets(server);
}
