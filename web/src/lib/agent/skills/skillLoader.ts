import { readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parseSkillDocument } from "./frontmatter";
import type { AgentSkillRegistry } from "./skillRegistry";
import type { AgentSkillMetadata } from "./types";

function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== ".." && !rel.startsWith(`..${sep}`);
}

export class AgentSkillLoader {
  constructor(private readonly registry: AgentSkillRegistry) {}

  load(name: string, version?: string): { metadata: AgentSkillMetadata; content: string } {
    const descriptor = this.registry.get(name, version);
    if (!descriptor || !descriptor.metadata.enabled) throw new Error("Skill not found or disabled");
    const document = parseSkillDocument(readFileSync(descriptor.skillFile, "utf8"));
    return { metadata: descriptor.metadata, content: document.body.trim() };
  }

  loadSupportingFile(name: string, relativePath: string, version?: string): string {
    const descriptor = this.registry.get(name, version);
    if (!descriptor) throw new Error("Skill not found");
    if (!relativePath || relativePath.includes("\0")) throw new Error("Invalid supporting-file path");
    const candidate = realpathSync(join(descriptor.directory, relativePath));
    if (!isContained(realpathSync(descriptor.directory), candidate) || !statSync(candidate).isFile()) {
      throw new Error("Supporting-file path escapes skill directory");
    }
    const content = readFileSync(candidate, "utf8");
    if (content.length > 100_000) throw new Error("Supporting file is too large");
    return content;
  }
}
