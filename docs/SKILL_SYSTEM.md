# Agent Skill System

AiChart now has one lazy registry rooted at `agent/workspace/skills`. It discovers child directories containing `SKILL.md`, reads only a bounded frontmatter header during discovery, validates metadata and loads full bodies only after explicit selection.

Metadata includes name, semantic version, description, category, enabled state, trust, locales, markets, required/forbidden tools, risk level and tags. Registry order and duplicate resolution are deterministic. Invalid skills create issues without preventing valid registry startup. Development callers can invalidate the metadata cache explicitly.

Trust is rooted server-side. Frontmatter may lower trust but a user root cannot promote itself to reviewed/system. A Skill never grants tool permission. Execution-related Skills require both explicit selector permission and server-authorized tools; they cannot override Risk Guard or Execution Guard.

Supporting files are resolved through real paths inside the skill directory. Traversal and symlink escape are rejected, and file size is bounded.

The initial registry exposes the existing `aichart-trading`, `cards`, `trading-lexicon` and `trading-strategies` Skills. No Vibe skill bodies were copied. The read-only MCP adapter (`list_agent_skills`, `load_agent_skill` contract) uses the same registry. Actual MCP registration is intentionally incremental so existing resources and names remain unchanged.
