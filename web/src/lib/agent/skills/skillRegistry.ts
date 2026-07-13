import { closeSync, existsSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { parseSkillDocument } from "./frontmatter";
import { validateSkillMetadata } from "./skillValidator";
import type { AgentSkillDescriptor, AgentSkillIssue, AgentSkillTrust } from "./types";

const HEADER_BYTES = 16_384;

export interface SkillRoot { path: string; trust: AgentSkillTrust; category?: string }

function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !resolve(rel).startsWith(sep));
}

function readHeader(path: string): string {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const count = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, count).toString("utf8");
  } finally { closeSync(fd); }
}

export class AgentSkillRegistry {
  private descriptors = new Map<string, AgentSkillDescriptor>();
  private issues: AgentSkillIssue[] = [];
  private loaded = false;

  constructor(private readonly roots: SkillRoot[]) {}

  discover(force = false): AgentSkillDescriptor[] {
    if (this.loaded && !force) return this.list();
    this.descriptors.clear();
    this.issues = [];
    const found: AgentSkillDescriptor[] = [];
    for (const configured of this.roots) {
      if (!existsSync(configured.path)) continue;
      const root = realpathSync(configured.path);
      for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const directoryPath = join(root, entry.name);
        let directory: string;
        try { directory = realpathSync(directoryPath); } catch { continue; }
        if (!within(root, directory)) {
          this.issues.push({ code: "UNSAFE_PATH", path: directoryPath, message: "skill directory escapes configured root" });
          continue;
        }
        const skillFile = join(directory, "SKILL.md");
        if (!existsSync(skillFile) || !statSync(skillFile).isFile()) continue;
        const parsed = parseSkillDocument(readHeader(skillFile));
        const validated = validateSkillMetadata(parsed.frontmatter, configured);
        if (!validated.ok) {
          this.issues.push({ code: "INVALID_SKILL", path: skillFile, message: validated.error });
          continue;
        }
        found.push({ metadata: validated.metadata, directory, skillFile });
      }
    }
    found.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name) || a.metadata.version.localeCompare(b.metadata.version));
    for (const descriptor of found) {
      const key = `${descriptor.metadata.name}@${descriptor.metadata.version}`;
      if (this.descriptors.has(key)) {
        this.issues.push({ code: "DUPLICATE_SKILL", path: descriptor.skillFile, message: `duplicate ${key}` });
        continue;
      }
      this.descriptors.set(key, descriptor);
    }
    this.loaded = true;
    return this.list();
  }

  list(): AgentSkillDescriptor[] {
    return [...this.descriptors.values()].sort((a, b) => a.metadata.name.localeCompare(b.metadata.name) || a.metadata.version.localeCompare(b.metadata.version));
  }

  get(name: string, version?: string): AgentSkillDescriptor | undefined {
    const matches = this.list().filter((descriptor) => descriptor.metadata.name === name && (!version || descriptor.metadata.version === version));
    return matches.at(-1);
  }

  getIssues(): AgentSkillIssue[] { return [...this.issues]; }
  invalidate(): void { this.loaded = false; this.descriptors.clear(); this.issues = []; }
}
