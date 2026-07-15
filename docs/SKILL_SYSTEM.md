# Agent Skill System

AiChart has one lazy registry rooted at `agent/workspace/skills`. It discovers child directories containing `SKILL.md`, reads only a bounded frontmatter header during discovery, validates metadata and loads full bodies only after explicit selection.

Metadata includes name, semantic version, description, category, enabled state, trust, locales, markets, required/forbidden tools, risk level and tags. Registry order and duplicate resolution are deterministic. Invalid skills create issues without preventing valid registry startup. Development callers can invalidate the metadata cache explicitly.

Trust is rooted server-side. Frontmatter may lower trust but a user root cannot promote itself to reviewed/system. A Skill never grants tool permission. Execution-related Skills require both explicit selector permission and server-authorized tools; they cannot override Risk Guard or Execution Guard.

Supporting files are resolved through real paths inside the skill directory. Traversal and symlink escape are rejected, and file size is bounded.

The registry exposes the existing `aichart-trading`, `cards`, `trading-lexicon` and `trading-strategies` Skills. No Vibe skill bodies were copied.

## Concepts (do not conflate)

| Primitive | Role |
|-----------|------|
| **Resources** | Readable documents / metadata stubs. Visible ≠ loaded into model context as a skill. |
| **Prompts** | Invocable templates (e.g. `aichart_start`). Not auto-executed. |
| **Skills** | Catalogue entries under `agent/workspace/skills`. Loaded only via `load_agent_skill` (MCP) or web selector. |
| **Tools** | Bridge/actions. Skills never grant tool permission. |

## Runtime integration (live)

- **Web agent**: `skillContext.ts` runs inside the unified orchestrator for market-analysis intents (gated by `FEATURE_AGENT_SKILLS`, default on). It discovers metadata, selects by intent/locale/market/available tools (max 2 skills), lazily loads bounded bodies into the decision synthesizer prompt, and reports failures honestly. Loaded skill names/versions go to runTrace only — stripped from SSE/client payloads.
- **MCP**: `list_agent_skills` (discover) → `resolve_agent_skills` (capability-scored select) → `load_agent_skill` (lazy load). Scoring uses category, riskLevel, description, and tags — not skill-name if/else maps. Skill URIs return metadata stubs only. Manual attachment is unnecessary for all MCP clients.
- Execution-risk skills never load without `allow_execution_skills`; skills never grant permissions and never bypass Risk Guard/Execution Guard.

## Runtime proof

See `mcp/src/skills/__tests__/skillIntelligentSelection.test.ts` and `skillRuntimeProof.test.ts`.
