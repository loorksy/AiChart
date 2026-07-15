# Agent Skill System

AiChart now has one lazy registry rooted at `agent/workspace/skills`. It discovers child directories containing `SKILL.md`, reads only a bounded frontmatter header during discovery, validates metadata and loads full bodies only after explicit selection.

Metadata includes name, semantic version, description, category, enabled state, trust, locales, markets, required/forbidden tools, risk level and tags. Registry order and duplicate resolution are deterministic. Invalid skills create issues without preventing valid registry startup. Development callers can invalidate the metadata cache explicitly.

Trust is rooted server-side. Frontmatter may lower trust but a user root cannot promote itself to reviewed/system. A Skill never grants tool permission. Execution-related Skills require both explicit selector permission and server-authorized tools; they cannot override Risk Guard or Execution Guard.

Supporting files are resolved through real paths inside the skill directory. Traversal and symlink escape are rejected, and file size is bounded.

The registry exposes the existing `aichart-trading`, `cards`, `trading-lexicon` and `trading-strategies` Skills. No Vibe skill bodies were copied.

## Runtime integration (live)

- **Web agent**: `skillContext.ts` runs inside the unified orchestrator for market-analysis intents (gated by `FEATURE_AGENT_SKILLS`, default on). It discovers metadata, selects by intent/locale/market/available tools (max 2 skills), lazily loads bounded bodies into the decision synthesizer prompt, and reports failures honestly. Loaded skill names/versions surface on the final result (`selectedSkills`) and in the run trace.
- **MCP**: `list_agent_skills` (metadata-only discovery) and `load_agent_skill` (explicit traceable load) read the SAME `agent/workspace/skills` directory. A visible `aichart://…` resource does not count as a loaded skill; loads either succeed with real content or fail with an explicit reason.
- Execution-risk skills (`aichart-trading`) never load into the chart-agent context; skills never grant permissions and never bypass Risk Guard/Execution Guard.
