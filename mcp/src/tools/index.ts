import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";
import { tradingRulesText, readWorkspaceFile } from "./helpers.js";
import { registerMarketTools } from "./market.js";
import { registerCoreTools } from "./core.js";
import { registerBinanceTools } from "./binance.js";
import { registerMt5Tools } from "./mt5.js";
import { registerChartsTools } from "./charts.js";
import { registerWidgets } from "../ui/index.js";
import { bootstrapText } from "../onboarding/bootstrap.js";

export function registerAiChartTools(server: McpServer, bridge: BridgeClient) {
  // Bootstrap "first message" as an invocable prompt (slash command in hosts
  // that support prompts). Same canonical text as the copy panel + instructions.
  server.registerPrompt(
    "aichart_start",
    {
      title: "AiChart — bootstrap message (agent setup)",
      description:
        "Paste as the first message after connecting MCP: loads rules, reads skills, summarizes account.",
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
      id: "trading-lexicon",
      uri: "aichart://trading-lexicon",
      title: "AiChart Trading Lexicon Skill",
      description: "Smart money and market terminology guide",
      file: "skills/trading-lexicon/SKILL.md",
    },
    {
      id: "trading-strategies",
      uri: "aichart://trading-strategies",
      title: "AiChart Trading Strategies Skill",
      description: "Combinatorial matrix of 10,000 trading strategy configurations (English)",
      file: "skills/trading-strategies/SKILL.md",
    },
    {
      id: "execution-desk",
      uri: "aichart://execution-desk",
      title: "AiChart Execution Desk v3 (Disciplined)",
      description:
        "Institutional execution desk: four-agent committee (diagnostic scores) + objective quality gates + EXECUTE/NO TRADE decision",
      file: "EXECUTION_DESK_V3.md",
    },
    {
      id: "cards",
      uri: "aichart://cards",
      title: "AiChart Interactive Cards Skill",
      description: "When and how to show interactive cards (mini widgets) and full catalog",
      file: "skills/cards/SKILL.md",
    },
    {
      id: "ea-troubleshooting",
      uri: "aichart://ea-troubleshooting",
      title: "AiChart EA Troubleshooting",
      description: "MetaTrader EA connection troubleshooting guide",
      file: "EA_TROUBLESHOOTING.md",
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
      })
    );
  }

  registerCoreTools(server, bridge);
  registerMarketTools(server, bridge);
  registerBinanceTools(server, bridge);
  registerMt5Tools(server, bridge);
  registerChartsTools(server, bridge);
  registerWidgets(server);
}
