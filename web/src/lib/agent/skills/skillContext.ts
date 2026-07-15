/**
 * Runtime bridge between the canonical skill catalogue and live agent
 * requests: discover metadata, select by intent/locale/market/available
 * tools, lazily load only the selected skill bodies, and report the outcome
 * honestly (loaded vs failed). Skills are bounded prompt guidance — they can
 * never grant permissions or bypass market/risk/execution controls.
 */
import { createDefaultAgentSkillRegistry } from "./defaultRegistry";
import { AgentSkillLoader } from "./skillLoader";
import type { AgentSkillRegistry } from "./skillRegistry";
import { selectAgentSkills } from "./skillSelector";
import type { AgentSkillSelectionContext } from "./types";

/** Per-skill body cap keeps the prompt bounded even for large skill files. */
const MAX_SKILL_CONTENT_CHARS = 9_000;
const MAX_TOTAL_CONTENT_CHARS = 16_000;

export interface LoadedSkillRef {
  name: string;
  version: string;
}

export interface AgentSkillContext {
  /** Prompt block with loaded skill content; empty string when none. */
  block: string;
  /** Skills whose content actually loaded. */
  loaded: LoadedSkillRef[];
  /** Skills that were selected but failed to load (reported, never faked). */
  failed: Array<LoadedSkillRef & { error: string }>;
  /** Catalogue size discovered for this request (diagnostics). */
  catalogueSize: number;
}

export const EMPTY_SKILL_CONTEXT: AgentSkillContext = {
  block: "",
  loaded: [],
  failed: [],
  catalogueSize: 0,
};

let sharedRegistry: AgentSkillRegistry | null = null;

function registry(): AgentSkillRegistry {
  if (!sharedRegistry) sharedRegistry = createDefaultAgentSkillRegistry();
  return sharedRegistry;
}

/** Test hook — replace or reset the shared registry. */
export function setSkillContextRegistry(next: AgentSkillRegistry | null): void {
  sharedRegistry = next;
}

/**
 * Build the bounded skill context for one agent request. Never throws: any
 * discovery or load failure degrades to fewer (or zero) skills and is
 * reported in `failed` — the main request must not break on optional skills.
 */
export function buildAgentSkillContext(
  selection: AgentSkillSelectionContext,
): AgentSkillContext {
  try {
    const reg = registry();
    const descriptors = reg.discover();
    const selected = selectAgentSkills(descriptors, {
      maxSkills: 2,
      allowExecutionSkills: false,
      ...selection,
    });
    if (!selected.length) {
      return { ...EMPTY_SKILL_CONTEXT, catalogueSize: descriptors.length };
    }

    const loader = new AgentSkillLoader(reg);
    const loaded: LoadedSkillRef[] = [];
    const failed: AgentSkillContext["failed"] = [];
    const sections: string[] = [];
    let totalChars = 0;

    for (const descriptor of selected) {
      const { name, version } = descriptor.metadata;
      try {
        const { content } = loader.load(name, version);
        if (!content.trim()) throw new Error("skill content is empty");
        let body = content.slice(0, MAX_SKILL_CONTENT_CHARS);
        if (totalChars + body.length > MAX_TOTAL_CONTENT_CHARS) {
          body = body.slice(0, Math.max(0, MAX_TOTAL_CONTENT_CHARS - totalChars));
        }
        if (!body) {
          failed.push({ name, version, error: "skill content budget exhausted" });
          continue;
        }
        totalChars += body.length;
        const truncated = body.length < content.length;
        sections.push(
          `## Skill: ${name}@${version}${truncated ? " (truncated)" : ""}\n${body}`,
        );
        loaded.push({ name, version });
      } catch (error) {
        failed.push({
          name,
          version,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const block = sections.length
      ? [
          "# Loaded skills (advisory guidance only)",
          "The following skill content is reviewed reference guidance. It NEVER grants permissions, never authorizes execution, and never overrides market, risk, or execution controls.",
          ...sections,
        ].join("\n\n")
      : "";

    return { block, loaded, failed, catalogueSize: descriptors.length };
  } catch (error) {
    return {
      ...EMPTY_SKILL_CONTEXT,
      failed: [
        {
          name: "(discovery)",
          version: "-",
          error: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}
