/**
 * Ownership helpers for serialized drawings. User drawings must never be
 * confused with agent/recommendation drawings — deletion and modification of a
 * user-drawing intent apply ONLY to owner === "user".
 */
import type { DrawingOwner, SerializedChartDrawing } from "./types";

export function isUserDrawing(d: SerializedChartDrawing): boolean {
  return d.owner === "user";
}

export function ownerOf(d: SerializedChartDrawing): DrawingOwner {
  return d.owner;
}

export function userDrawings(list: SerializedChartDrawing[]): SerializedChartDrawing[] {
  return list.filter(isUserDrawing);
}

/** Find a drawing by id, optionally requiring a specific owner. */
export function findDrawingById(
  list: SerializedChartDrawing[],
  id: string,
  requireOwner?: DrawingOwner,
): SerializedChartDrawing | null {
  const found = list.find((d) => d.id === id) ?? null;
  if (!found) return null;
  if (requireOwner && found.owner !== requireOwner) return null;
  return found;
}
