/**
 * Pure helpers for the movable floating Chart/Chat workspace switcher.
 * Position is physical left/right edge + vertical offset (px from top).
 */
export type SwitcherEdge = "left" | "right";

export interface SwitcherPosition {
  edge: SwitcherEdge;
  y: number;
}

export const SWITCHER_STORAGE_KEY = "aichart_workspace_switcher_pos";
export const SWITCHER_DRAG_THRESHOLD_PX = 8;
export const SWITCHER_WIDTH = 52;
export const SWITCHER_HEIGHT = 96;

/** RTL → physical left; LTR → physical right. */
export function defaultSwitcherEdge(dir: "rtl" | "ltr"): SwitcherEdge {
  return dir === "rtl" ? "left" : "right";
}

export function defaultSwitcherPosition(
  dir: "rtl" | "ltr",
  viewportHeight = 800,
): SwitcherPosition {
  const safeTop = 72;
  const safeBottom = 120;
  const usable = Math.max(safeTop, viewportHeight - SWITCHER_HEIGHT - safeBottom);
  return {
    edge: defaultSwitcherEdge(dir),
    y: Math.round(Math.min(Math.max(viewportHeight * 0.38, safeTop), usable)),
  };
}

export function clampSwitcherY(y: number, viewportHeight: number): number {
  const min = 56;
  const max = Math.max(min, viewportHeight - SWITCHER_HEIGHT - 24);
  if (!Number.isFinite(y)) return min;
  return Math.round(Math.min(Math.max(y, min), max));
}

export function snapSwitcherEdge(clientX: number, viewportWidth: number): SwitcherEdge {
  return clientX < viewportWidth / 2 ? "left" : "right";
}

export function parseSwitcherPosition(
  raw: string | null,
  dir: "rtl" | "ltr",
  viewportHeight: number,
): SwitcherPosition {
  const fallback = defaultSwitcherPosition(dir, viewportHeight);
  if (!raw) return fallback;
  try {
    const obj = JSON.parse(raw) as { edge?: unknown; y?: unknown };
    const edge = obj.edge === "left" || obj.edge === "right" ? obj.edge : fallback.edge;
    const y = clampSwitcherY(typeof obj.y === "number" ? obj.y : fallback.y, viewportHeight);
    return { edge, y };
  } catch {
    return fallback;
  }
}

export function loadSwitcherPosition(
  dir: "rtl" | "ltr",
  viewportHeight: number,
): SwitcherPosition {
  if (typeof window === "undefined") return defaultSwitcherPosition(dir, viewportHeight);
  return parseSwitcherPosition(
    window.localStorage.getItem(SWITCHER_STORAGE_KEY),
    dir,
    viewportHeight,
  );
}

export function saveSwitcherPosition(pos: SwitcherPosition, viewportHeight: number): void {
  if (typeof window === "undefined") return;
  const next = { edge: pos.edge, y: clampSwitcherY(pos.y, viewportHeight) };
  window.localStorage.setItem(SWITCHER_STORAGE_KEY, JSON.stringify(next));
}
