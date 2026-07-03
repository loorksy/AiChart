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
      title: "AiChart — رسالة البدء (تهيئة الوكيل)",
      description:
        "الصقها كأول رسالة بعد ربط الـMCP: تُحمّل القواعد، تقرأ المهارات، وتلخّص الحساب.",
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
      id: "trading-rules",
      uri: "aichart://trading-rules",
      title: "AiChart Trading Rules (AGENTS.md)",
      description: "قواعد التشغيل والتداول للوكيل",
      file: "AGENTS.md",
    },
    {
      id: "trading-lexicon",
      uri: "aichart://trading-lexicon",
      title: "AiChart Trading Lexicon Skill",
      description: "دليل مصطلحات واستراتيجيات المال الذكي والأسواق (عربي)",
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
        "إطار مكتب التنفيذ المؤسسي: لجنة الوكلاء الأربعة (درجات تشخيصية) + بوابات الجودة الموضوعية + قرار EXECUTE/NO TRADE",
      file: "EXECUTION_DESK_V3.md",
    },
    {
      id: "cards",
      uri: "aichart://cards",
      title: "AiChart Interactive Cards Skill",
      description: "متى وكيف تعرض البطاقات التفاعلية (نماذج مصغّرة) وكتالوجها الكامل",
      file: "skills/cards/SKILL.md",
    },
    {
      id: "ea-troubleshooting",
      uri: "aichart://ea-troubleshooting",
      title: "AiChart EA Troubleshooting",
      description: "دليل استكشاف أخطاء وإصلاح اتصال MetaTrader EA",
      file: "EA_TROUBLESHOOTING.md",
    },
    {
      id: "heartbeat",
      uri: "aichart://heartbeat",
      title: "AiChart Heartbeat Spec",
      description: "تفاصيل صيانة ومراقبة الصفقات ونبضات القلب التلقائية",
      file: "HEARTBEAT.md",
    },
    {
      id: "memory",
      uri: "aichart://memory",
      title: "AiChart Memory",
      description: "ملف الذاكرة الدائمة للحقائق والدروس المستفادة والصفقات",
      file: "MEMORY.md",
    },
    {
      id: "soul",
      uri: "aichart://soul",
      title: "AiChart Soul Profile",
      description: "ملف شخصية الخبير للوكيل والأسلوب المتبع والمبادئ",
      file: "SOUL.md",
    },
    {
      id: "user",
      uri: "aichart://user",
      title: "AiChart Operator Profile",
      description: "ملف معلومات وتفضيلات المشغّل البشري",
      file: "USER.md",
    },
    {
      id: "agent-readme",
      uri: "aichart://agent-readme",
      title: "AiChart Agent README",
      description: "دليل مستندات وهيكل الوكيل الفني",
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
