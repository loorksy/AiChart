/** Normalize HTTP path segments from ui:// URIs or malformed comma joins. */
export function normalizeWidgetPublicPath(path: string): string {
  let p = String(path ?? "")
    .replace(/^\/+/, "")
    .replace(/^ui:\/\/aichart\//, "");
  // Express 5 / some hosts stringify path arrays as "a,b" instead of "a/b".
  if (p.includes(",")) p = p.replace(/,/g, "/");
  return p;
}
