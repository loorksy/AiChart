export interface ParsedSkillDocument {
  frontmatter: Record<string, unknown>;
  body: string;
}

function scalar(raw: string): unknown {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if ((value.startsWith("[") && value.endsWith("]")) || (value.startsWith("{") && value.endsWith("}"))) {
    try { return JSON.parse(value); } catch { /* use conservative text fallback */ }
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/** Minimal deterministic YAML subset for flat skill metadata. */
export function parseSkillDocument(text: string): ParsedSkillDocument {
  const normalized = text.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) {
    return { frontmatter: {}, body: normalized };
  }
  const end = normalized.search(/\r?\n---\r?\n/);
  if (end < 0) return { frontmatter: {}, body: normalized };
  const header = normalized.slice(normalized.indexOf("\n") + 1, end);
  const frontmatter: Record<string, unknown> = {};
  for (const line of header.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (match) frontmatter[match[1]!] = scalar(match[2]!);
  }
  const bodyStart = normalized.indexOf("\n", end + 5);
  return { frontmatter, body: bodyStart >= 0 ? normalized.slice(bodyStart + 1) : "" };
}
