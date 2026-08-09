"use client";

import { create } from "zustand";
import type { DashboardPeriod } from "@/lib/admin/overviewQueries";

/**
 * Client state for the platform overview. It holds only what the user chose —
 * never a copy of server data — so a refetch can never race a filter.
 *
 * `period` lives here rather than in the chart because two controls drive it
 * (the header segmented control and the chart's own dropdown) and they must
 * never disagree about which window is on screen.
 */

export type ChartKind = "line" | "area";
export type SeriesKey = "revenue" | "cost" | "profit";
export type LeaderMetric = "revenue" | "loss";
export type UsersSortKey =
  | "email"
  | "created_at_ms"
  | "tier"
  | "status"
  | "revenue_usd"
  | "provider_cost_usd"
  | "profit_usd"
  | "events"
  | "last_event_ms";

export interface AdminDashboardState {
  period: DashboardPeriod;
  chartKind: ChartKind;
  showGrid: boolean;
  visibleSeries: Record<SeriesKey, boolean>;
  leaderMetric: LeaderMetric;
  search: string;
  tierFilter: string;
  statusFilter: string;
  subFilter: string; // "" = all
  sortKey: UsersSortKey;
  sortDir: "asc" | "desc";
  page: number;
  pageSize: 10 | 25 | 50;
  selected: number[];
  setPeriod(p: DashboardPeriod): void;
  setChartKind(k: ChartKind): void;
  toggleGrid(): void;
  toggleSeries(k: SeriesKey): void;
  setLeaderMetric(m: LeaderMetric): void;
  setSearch(v: string): void;
  setTierFilter(v: string): void;
  setStatusFilter(v: string): void;
  setSubFilter(v: string): void;
  toggleSort(k: UsersSortKey): void;
  setPage(n: number): void;
  setPageSize(n: 10 | 25 | 50): void;
  toggleSelect(id: number): void;
  toggleSelectAll(ids: number[]): void;
  clearFilters(): void;
}

/**
 * Text columns read naturally A→Z on first click; money, counts and timestamps
 * are almost always asked for "biggest first", so they open descending.
 */
const DESCENDING_FIRST: ReadonlySet<UsersSortKey> = new Set<UsersSortKey>([
  "created_at_ms",
  "revenue_usd",
  "provider_cost_usd",
  "profit_usd",
  "events",
  "last_event_ms",
]);

export const useAdminDashboardStore = create<AdminDashboardState>((set) => ({
  period: 30,
  chartKind: "area",
  showGrid: true,
  visibleSeries: { revenue: true, cost: true, profit: true },
  leaderMetric: "revenue",
  search: "",
  tierFilter: "",
  statusFilter: "",
  subFilter: "",
  sortKey: "created_at_ms",
  sortDir: "desc",
  page: 1,
  pageSize: 25,
  selected: [],

  setPeriod: (p) => set({ period: p }),
  setChartKind: (k) => set({ chartKind: k }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleSeries: (k) =>
    set((s) => ({ visibleSeries: { ...s.visibleSeries, [k]: !s.visibleSeries[k] } })),
  setLeaderMetric: (m) => set({ leaderMetric: m }),

  // Narrowing the result set can strand the viewer on a page that no longer
  // exists, so every filter change also returns to page 1.
  setSearch: (v) => set({ search: v, page: 1 }),
  setTierFilter: (v) => set({ tierFilter: v, page: 1 }),
  setStatusFilter: (v) => set({ statusFilter: v, page: 1 }),
  setSubFilter: (v) => set({ subFilter: v, page: 1 }),

  toggleSort: (k) =>
    set((s) =>
      s.sortKey === k
        ? { sortDir: s.sortDir === "asc" ? "desc" : "asc", page: 1 }
        : { sortKey: k, sortDir: DESCENDING_FIRST.has(k) ? "desc" : "asc", page: 1 },
    ),

  setPage: (n) => set({ page: Math.max(1, Math.trunc(n)) }),
  setPageSize: (n) => set({ pageSize: n, page: 1 }),

  toggleSelect: (id) =>
    set((s) => ({
      selected: s.selected.includes(id)
        ? s.selected.filter((v) => v !== id)
        : [...s.selected, id],
    })),

  // `ids` is the currently visible page: a partial selection fills the page in,
  // a complete one clears just those rows and leaves other pages selected.
  toggleSelectAll: (ids) =>
    set((s) => {
      const allSelected = ids.length > 0 && ids.every((id) => s.selected.includes(id));
      if (allSelected) {
        return { selected: s.selected.filter((id) => !ids.includes(id)) };
      }
      const merged = new Set(s.selected);
      for (const id of ids) merged.add(id);
      return { selected: [...merged] };
    }),

  clearFilters: () =>
    set({ search: "", tierFilter: "", statusFilter: "", subFilter: "", page: 1 }),
}));
