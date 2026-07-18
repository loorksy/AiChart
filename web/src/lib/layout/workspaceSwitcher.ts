/**
 * Free-position Chart/Chat switcher helpers.
 * Supports free XY placement, top dock, composer merge, and compact collapse.
 */

export type SwitcherDock = "free" | "top" | "composer";

export interface SwitcherPosition {
  x: number;
  y: number;
  dock: SwitcherDock;
  collapsed: boolean;
}

/** @deprecated kept for reading legacy localStorage payloads */
export type SwitcherEdge = "left" | "right";

export const SWITCHER_STORAGE_KEY = "aichart_workspace_switcher_pos_v2";
export const SWITCHER_STORAGE_KEY_LEGACY = "aichart_workspace_switcher_pos";
export const SWITCHER_DRAG_THRESHOLD_PX = 8;
export const SWITCHER_WIDTH = 52;
/** Free vertical chrome: grip + menu + chart + chat + collapse (+ optional reset). */
export const SWITCHER_HEIGHT = 140;
export const SWITCHER_COLLAPSED_SIZE = 40;
export const SWITCHER_COMPOSER_ZONE_PX = 108;
export const SWITCHER_TOP_ZONE_PX = 72;

export function defaultSwitcherEdge(dir: "rtl" | "ltr"): SwitcherEdge {
  return dir === "rtl" ? "left" : "right";
}

export function defaultSwitcherPosition(
  dir: "rtl" | "ltr",
  viewportWidth = 390,
  viewportHeight = 800,
): SwitcherPosition {
  const edge = defaultSwitcherEdge(dir);
  const x =
    edge === "left"
      ? 8
      : Math.max(8, viewportWidth - SWITCHER_WIDTH - 8);
  const y = Math.round(
    Math.min(
      Math.max(viewportHeight * 0.38, 72),
      Math.max(72, viewportHeight - SWITCHER_HEIGHT - 120),
    ),
  );
  return { x, y, dock: "free", collapsed: false };
}

export function clampSwitcherPoint(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  size = { w: SWITCHER_WIDTH, h: SWITCHER_HEIGHT },
): { x: number; y: number } {
  const minX = 4;
  const minY = 4;
  const maxX = Math.max(minX, viewportWidth - size.w - 4);
  const maxY = Math.max(minY, viewportHeight - size.h - 4);
  return {
    x: Math.round(Math.min(Math.max(Number.isFinite(x) ? x : minX, minX), maxX)),
    y: Math.round(Math.min(Math.max(Number.isFinite(y) ? y : minY, minY), maxY)),
  };
}

/** @deprecated use clampSwitcherPoint */
export function clampSwitcherY(y: number, viewportHeight: number): number {
  return clampSwitcherPoint(0, y, 400, viewportHeight).y;
}

/** @deprecated edge snap no longer primary; kept for tests */
export function snapSwitcherEdge(clientX: number, viewportWidth: number): SwitcherEdge {
  return clientX < viewportWidth / 2 ? "left" : "right";
}

export function resolveDockFromPoint(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
): SwitcherDock {
  void x;
  void viewportWidth;
  // Use the control's top/bottom edges so taller chrome still docks reliably.
  if (y + SWITCHER_HEIGHT >= viewportHeight - SWITCHER_COMPOSER_ZONE_PX) {
    return "composer";
  }
  if (y <= SWITCHER_TOP_ZONE_PX) return "top";
  return "free";
}

export function positionForDock(
  dock: SwitcherDock,
  viewportWidth: number,
  viewportHeight: number,
  collapsed: boolean,
): Pick<SwitcherPosition, "x" | "y"> {
  const w = collapsed ? SWITCHER_COLLAPSED_SIZE : dock === "free" ? SWITCHER_WIDTH : 176;
  const h = collapsed ? SWITCHER_COLLAPSED_SIZE : dock === "free" ? SWITCHER_HEIGHT : 44;
  if (dock === "composer") {
    return clampSwitcherPoint(
      (viewportWidth - w) / 2,
      viewportHeight - h - 12 - 8,
      viewportWidth,
      viewportHeight,
      { w, h },
    );
  }
  if (dock === "top") {
    return clampSwitcherPoint((viewportWidth - w) / 2, 10, viewportWidth, viewportHeight, {
      w,
      h,
    });
  }
  return clampSwitcherPoint(8, viewportHeight * 0.38, viewportWidth, viewportHeight, { w, h });
}

function migrateLegacy(
  raw: string,
  dir: "rtl" | "ltr",
  viewportWidth: number,
  viewportHeight: number,
): SwitcherPosition | null {
  try {
    const obj = JSON.parse(raw) as { edge?: unknown; y?: unknown };
    if (obj.edge !== "left" && obj.edge !== "right") return null;
    const x =
      obj.edge === "left" ? 8 : Math.max(8, viewportWidth - SWITCHER_WIDTH - 8);
    const y = clampSwitcherY(typeof obj.y === "number" ? obj.y : 200, viewportHeight);
    return { x, y, dock: "free", collapsed: false };
  } catch {
    void dir;
    return null;
  }
}

export function parseSwitcherPosition(
  raw: string | null,
  dir: "rtl" | "ltr",
  viewportWidth: number,
  viewportHeight: number,
): SwitcherPosition {
  const fallback = defaultSwitcherPosition(dir, viewportWidth, viewportHeight);
  if (!raw) return fallback;
  try {
    const obj = JSON.parse(raw) as Partial<SwitcherPosition> & { edge?: unknown };
    if (obj.edge === "left" || obj.edge === "right") {
      return (
        migrateLegacy(raw, dir, viewportWidth, viewportHeight) ?? fallback
      );
    }
    const dock: SwitcherDock =
      obj.dock === "top" || obj.dock === "composer" || obj.dock === "free"
        ? obj.dock
        : "free";
    const collapsed = Boolean(obj.collapsed);
    const size = collapsed
      ? { w: SWITCHER_COLLAPSED_SIZE, h: SWITCHER_COLLAPSED_SIZE }
      : dock === "free"
        ? { w: SWITCHER_WIDTH, h: SWITCHER_HEIGHT }
        : { w: 176, h: 44 };
    const point = clampSwitcherPoint(
      typeof obj.x === "number" ? obj.x : fallback.x,
      typeof obj.y === "number" ? obj.y : fallback.y,
      viewportWidth,
      viewportHeight,
      size,
    );
    return { ...point, dock, collapsed };
  } catch {
    return fallback;
  }
}

export function loadSwitcherPosition(
  dir: "rtl" | "ltr",
  viewportWidth: number,
  viewportHeight: number,
): SwitcherPosition {
  if (typeof window === "undefined") {
    return defaultSwitcherPosition(dir, viewportWidth, viewportHeight);
  }
  const v2 = window.localStorage.getItem(SWITCHER_STORAGE_KEY);
  if (v2) return parseSwitcherPosition(v2, dir, viewportWidth, viewportHeight);
  const legacy = window.localStorage.getItem(SWITCHER_STORAGE_KEY_LEGACY);
  if (legacy) {
    const migrated = migrateLegacy(legacy, dir, viewportWidth, viewportHeight);
    if (migrated) {
      saveSwitcherPosition(migrated, viewportWidth, viewportHeight);
      return migrated;
    }
  }
  return defaultSwitcherPosition(dir, viewportWidth, viewportHeight);
}

export function saveSwitcherPosition(
  pos: SwitcherPosition,
  viewportWidth: number,
  viewportHeight: number,
): void {
  if (typeof window === "undefined") return;
  const size = pos.collapsed
    ? { w: SWITCHER_COLLAPSED_SIZE, h: SWITCHER_COLLAPSED_SIZE }
    : pos.dock === "free"
      ? { w: SWITCHER_WIDTH, h: SWITCHER_HEIGHT }
      : { w: 176, h: 44 };
  const point = clampSwitcherPoint(pos.x, pos.y, viewportWidth, viewportHeight, size);
  window.localStorage.setItem(
    SWITCHER_STORAGE_KEY,
    JSON.stringify({ ...pos, ...point }),
  );
}
