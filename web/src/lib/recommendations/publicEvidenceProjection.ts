/**
 * What a browser is allowed to see of a revision's evidence.
 *
 * The internal snapshot is the whole bundle the brain decided on: model
 * context, the numeric level menu, historical cases — and up to three full
 * base64 PNGs of the chart. It exists for audit, re-evaluation, parity and
 * decision reproduction. None of that belongs on the wire to a browser, and
 * the images alone can run to megabytes per revision.
 *
 * So there are two shapes, deliberately:
 *
 *   - the INTERNAL snapshot, in its own append-only table, never serialized to
 *     a client;
 *   - this PUBLIC projection: the graded card the Evidence Card renders, plus
 *     the identity of the snapshot behind it (fingerprint, revision, when, from
 *     which surface) so the operator can see that evidence WAS frozen without
 *     receiving it.
 *
 * The projection is allow-list shaped — it names what may pass, rather than
 * trying to remove what may not, because a deny-list silently leaks whatever
 * gets added to the snapshot next.
 */
import type { EvidenceDimension } from "@/lib/agent/evidenceDimensions";

export interface PublicEvidenceProjection {
  schemaVersion: 1;
  /** Identity of the frozen snapshot — proof it exists, not its contents. */
  fingerprint: string | null;
  revisionNo: number | null;
  capturedAt: number | null;
  sourceSurface: string | null;
  /** The graded card the UI renders. */
  evidenceDimensions: EvidenceDimension[];
  /** Whether an internal snapshot is on file for this revision. */
  snapshotStored: boolean;
}

const ALLOWED_GRADES = new Set(["strong", "moderate", "weak", "unavailable", "contradicted"]);

/**
 * Keep only the four fields the card renders, and only when they are the
 * shapes it expects. A dimension that arrives malformed is dropped rather than
 * passed through, since anything unrecognised here came from somewhere that
 * should not be feeding the browser.
 */
function projectDimensions(input: unknown): EvidenceDimension[] {
  if (!Array.isArray(input)) return [];
  const out: EvidenceDimension[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const key = typeof item.key === "string" ? item.key : null;
    const grade = typeof item.grade === "string" ? item.grade : null;
    if (!key || !grade || !ALLOWED_GRADES.has(grade)) continue;
    const detail = typeof item.detail === "string" ? item.detail.slice(0, 400) : "";
    const value =
      typeof item.value === "number" || typeof item.value === "string"
        ? item.value
        : undefined;
    out.push({ key, grade, detail, value } as EvidenceDimension);
  }
  return out;
}

export function toPublicEvidenceProjection(input: {
  /** The stored operator-facing descriptor (revision.evidence). */
  descriptor?: Record<string, unknown> | null;
  fingerprint?: string | null;
  revisionNo?: number | null;
  capturedAt?: number | null;
  sourceSurface?: string | null;
  snapshotStored?: boolean;
}): PublicEvidenceProjection {
  const descriptor = input.descriptor ?? {};
  return {
    schemaVersion: 1,
    fingerprint: input.fingerprint ?? null,
    revisionNo: input.revisionNo ?? null,
    capturedAt: input.capturedAt ?? null,
    sourceSurface: input.sourceSurface ?? null,
    evidenceDimensions: projectDimensions(descriptor.evidenceDimensions),
    snapshotStored: Boolean(input.snapshotStored),
  };
}

/**
 * Assert no base64 image or obviously internal blob survived into a payload.
 *
 * Used by the tests and by the outbound sanitizer as a last line: the
 * projection above is allow-list shaped, so this should never fire — which is
 * exactly why it is worth checking.
 */
export function containsRawImagery(value: unknown, depth = 0): boolean {
  if (depth > 8 || value == null) return false;
  if (Array.isArray(value)) return value.some((entry) => containsRawImagery(entry, depth + 1));
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/imageBase64|image_base64|visualSnapshots|modelContext/i.test(key)) return true;
      if (containsRawImagery(entry, depth + 1)) return true;
    }
    return false;
  }
  if (typeof value === "string") {
    return value.length > 512 && /^data:image\/|^[A-Za-z0-9+/]{512,}={0,2}$/.test(value);
  }
  return false;
}
