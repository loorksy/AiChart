/** Express 5 `{*path}` wildcard → slash-separated path string. */
export function wildcardPath(params: Record<string, unknown>): string {
  const p = params.path;
  if (Array.isArray(p)) return p.map(String).join("/");
  return String(p ?? "").replace(/^\/+/, "");
}
