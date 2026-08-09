"use client";

import { useMemo, type ReactNode } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Activity01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowLeftDoubleIcon,
  ArrowRight01Icon,
  ArrowRightDoubleIcon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
  Calendar01Icon,
  CoinsDollarIcon,
  CreditCardIcon,
  FlashIcon,
  Invoice01Icon,
  Mail01Icon,
  MoneyBag02Icon,
  PackageIcon,
  Search01Icon,
  ServerStack01Icon,
  SlidersHorizontalIcon,
  UserIcon,
  UserMultiple02Icon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";
import { Button, buttonVariants } from "@/components/squareui/button";
import { Checkbox } from "@/components/squareui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/squareui/dropdown-menu";
import { Input } from "@/components/squareui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/squareui/select";
import {
  AdminTable,
  RecordCard,
  TableEmptyRow,
  TableSkeletonRows,
  TableWrap,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/admin/ui/AdminKit";
import { SkeletonLine } from "@/components/ui/skeleton";
import type { AdminOverviewUserRow } from "@/lib/admin/overviewQueries";
import { tierDef } from "@/lib/billing/tiers";
import { cn } from "@/lib/utils";
import { useAdminDashboardStore, type UsersSortKey } from "./dashboardStore";
import {
  EM_DASH,
  formatDate,
  formatInt,
  formatUsd,
  subStatusLabelAr,
  tierLabelAr,
  userStatusLabelAr,
} from "./format";

/**
 * Read-only roster with the money each account brings in and burns.
 *
 * Deliberately has no edit affordances: every mutation (status, access window,
 * quota, deletion) already lives in AdminUsersTable under the المستخدمون tab,
 * and two write paths over one table is how they drift apart.
 *
 * Below 640px each row renders as an AdminKit `RecordCard` instead of a
 * squashed table; both forms are driven by the same filtered/paged data, so
 * they cannot drift.
 */

/** Filter sentinel for "no tier"/"no subscription" — the store's "" means all. */
const NONE = "__none__";

const PAGE_SIZES = [10, 25, 50] as const;

function tierRank(tier: string | null): number {
  if (!tier) return -1;
  return tierDef(tier)?.priceUsd ?? 0;
}

function compareRows(
  a: AdminOverviewUserRow,
  b: AdminOverviewUserRow,
  key: UsersSortKey,
  dir: "asc" | "desc",
): number {
  const sign = dir === "asc" ? 1 : -1;
  switch (key) {
    case "email":
      return sign * a.email.localeCompare(b.email, "en");
    case "tier":
      return sign * (tierRank(a.tier) - tierRank(b.tier));
    case "status":
      return sign * userStatusLabelAr(a.status).localeCompare(userStatusLabelAr(b.status), "ar");
    case "created_at_ms":
      return sign * (a.created_at_ms - b.created_at_ms);
    case "events":
      return sign * (a.events - b.events);
    case "revenue_usd":
      return sign * (a.revenue_usd - b.revenue_usd);
    case "provider_cost_usd":
      return sign * (a.provider_cost_usd - b.provider_cost_usd);
    case "profit_usd":
      return sign * (a.profit_usd - b.profit_usd);
    case "last_event_ms": {
      // Accounts that never fired a request sort last in BOTH directions —
      // "oldest activity first" should not mean "never active first".
      if (a.last_event_ms === null && b.last_event_ms === null) return 0;
      if (a.last_event_ms === null) return 1;
      if (b.last_event_ms === null) return -1;
      return sign * (a.last_event_ms - b.last_event_ms);
    }
    default:
      return 0;
  }
}

/**
 * Account state, not trade direction — so this uses --success/--destructive
 * rather than --buy/--sell. Reusing the trading pair here would make "active"
 * read as a long position at a glance.
 */
function statusToneClass(status: string): string {
  if (status === "active") return "text-success";
  if (status === "suspended") return "text-destructive";
  return "text-warning";
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <HugeiconsIcon icon={ArrowUpDownIcon} className="size-3" />;
  return (
    <HugeiconsIcon icon={dir === "asc" ? ArrowUp01Icon : ArrowDown01Icon} className="size-3" />
  );
}

function ariaSort(active: boolean, dir: "asc" | "desc"): "ascending" | "descending" | "none" {
  if (!active) return "none";
  return dir === "asc" ? "ascending" : "descending";
}

function SortableHead({
  label,
  icon,
  sortKey,
}: {
  label: string;
  icon?: IconSvgElement;
  sortKey: UsersSortKey;
}) {
  const activeKey = useAdminDashboardStore((s) => s.sortKey);
  const dir = useAdminDashboardStore((s) => s.sortDir);
  const toggleSort = useAdminDashboardStore((s) => s.toggleSort);
  const active = activeKey === sortKey;

  return (
    <button
      type="button"
      onClick={() => toggleSort(sortKey)}
      className={cn(
        "focus-ring tap-target-expand -mx-1 flex items-center gap-1.5 rounded px-1 py-1 transition-colors duration-150 ease-out hover:text-foreground",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {icon && <HugeiconsIcon icon={icon} className="size-3.5" />}
      <span>{label}</span>
      <SortIcon active={active} dir={dir} />
    </button>
  );
}

/** `aria-sort` is only meaningful on the header cell, so the `th` carries it. */
function SortableTableHead({
  label,
  icon,
  sortKey,
}: {
  label: string;
  icon?: IconSvgElement;
  sortKey: UsersSortKey;
}) {
  const activeKey = useAdminDashboardStore((s) => s.sortKey);
  const dir = useAdminDashboardStore((s) => s.sortDir);
  return (
    <Th aria-sort={ariaSort(activeKey === sortKey, dir)}>
      <SortableHead label={label} icon={icon} sortKey={sortKey} />
    </Th>
  );
}

function StaticHead({ label, icon }: { label: string; icon?: IconSvgElement }) {
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      {icon && <HugeiconsIcon icon={icon} className="size-3.5" />}
      <span>{label}</span>
    </div>
  );
}

function FacetFilter({
  label,
  icon,
  value,
  options,
  onChange,
}: {
  label: string;
  icon: IconSvgElement;
  value: string;
  options: { value: string; label: string; count: number }[];
  onChange: (value: string) => void;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="tap-target-expand h-8 gap-1.5 border-border/50 bg-muted/50"
          >
            <HugeiconsIcon icon={icon} className="size-3.5" />
            <span className="max-w-[10rem] truncate">
              {current ? `${label}: ${current.label}` : label}
            </span>
            {value !== "" && <span className="size-1.5 rounded-full bg-primary" />}
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem checked={value === ""} onCheckedChange={() => onChange("")}>
            {label}: الكل
          </DropdownMenuCheckboxItem>
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={value === option.value}
              onCheckedChange={() => onChange(value === option.value ? "" : option.value)}
            >
              <span className="truncate">{option.label}</span>
              <span className="ms-auto text-xs text-muted-foreground tabular-nums">
                {formatInt(option.count)}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function buildFacet(
  rows: AdminOverviewUserRow[],
  pick: (row: AdminOverviewUserRow) => string,
  label: (key: string) => string,
): { value: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = pick(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: label(value), count }))
    .sort((a, b) => b.count - a.count);
}

export function DashboardUsersTable({
  rows,
  moneyVisible,
  profitVisible,
  loading,
}: {
  rows: AdminOverviewUserRow[];
  /** billing_read — الرصيد / التكلفة / الاستهلاك */
  moneyVisible: boolean;
  /** profit_read — الإيراد / الربح */
  profitVisible: boolean;
  loading: boolean;
}) {
  const search = useAdminDashboardStore((s) => s.search);
  const setSearch = useAdminDashboardStore((s) => s.setSearch);
  const tierFilter = useAdminDashboardStore((s) => s.tierFilter);
  const setTierFilter = useAdminDashboardStore((s) => s.setTierFilter);
  const statusFilter = useAdminDashboardStore((s) => s.statusFilter);
  const setStatusFilter = useAdminDashboardStore((s) => s.setStatusFilter);
  const subFilter = useAdminDashboardStore((s) => s.subFilter);
  const setSubFilter = useAdminDashboardStore((s) => s.setSubFilter);
  const clearFilters = useAdminDashboardStore((s) => s.clearFilters);
  const sortKey = useAdminDashboardStore((s) => s.sortKey);
  const sortDir = useAdminDashboardStore((s) => s.sortDir);
  const page = useAdminDashboardStore((s) => s.page);
  const setPage = useAdminDashboardStore((s) => s.setPage);
  const pageSize = useAdminDashboardStore((s) => s.pageSize);
  const setPageSize = useAdminDashboardStore((s) => s.setPageSize);
  const selected = useAdminDashboardStore((s) => s.selected);
  const toggleSelect = useAdminDashboardStore((s) => s.toggleSelect);
  const toggleSelectAll = useAdminDashboardStore((s) => s.toggleSelectAll);

  const tierOptions = useMemo(
    () => buildFacet(rows, (r) => r.tier ?? NONE, (k) => tierLabelAr(k === NONE ? null : k)),
    [rows],
  );
  const statusOptions = useMemo(
    () => buildFacet(rows, (r) => r.status, (k) => userStatusLabelAr(k)),
    [rows],
  );
  const subOptions = useMemo(
    () =>
      buildFacet(
        rows,
        (r) => r.sub_status ?? NONE,
        (k) => subStatusLabelAr(k === NONE ? null : k),
      ),
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const result = rows.filter((row) => {
      const matchesSearch =
        needle === "" ||
        row.email.toLowerCase().includes(needle) ||
        (row.username ?? "").toLowerCase().includes(needle);
      const matchesTier = tierFilter === "" || (row.tier ?? NONE) === tierFilter;
      const matchesStatus = statusFilter === "" || row.status === statusFilter;
      const matchesSub = subFilter === "" || (row.sub_status ?? NONE) === subFilter;
      return matchesSearch && matchesTier && matchesStatus && matchesSub;
    });
    return result.sort(
      (a, b) => compareRows(a, b, sortKey, sortDir) || a.user_id - b.user_id,
    );
  }, [rows, search, tierFilter, statusFilter, subFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize],
  );

  const pageIds = pageRows.map((r) => r.user_id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.includes(r.user_id)),
    [rows, selected],
  );
  const selectedTotals = useMemo(
    () =>
      selectedRows.reduce(
        (acc, r) => ({
          revenue: acc.revenue + r.revenue_usd,
          cost: acc.cost + r.provider_cost_usd,
          profit: acc.profit + r.profit_usd,
        }),
        { revenue: 0, cost: 0, profit: 0 },
      ),
    [selectedRows],
  );

  const hasActiveFilters =
    search !== "" || tierFilter !== "" || statusFilter !== "" || subFilter !== "";

  const columnCount = 8 + (moneyVisible ? 3 : 0) + (profitVisible ? 2 : 0);

  const pageNumbers = Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
    if (totalPages <= 5) return i + 1;
    if (safePage <= 3) return i + 1;
    if (safePage >= totalPages - 2) return totalPages - 4 + i;
    return safePage - 2 + i;
  });

  return (
    <div className="elevation-1 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card text-card-foreground">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <h3 className="type-subheading">المستخدمون والمال</h3>
          <div className="hidden h-5 w-px bg-border sm:block" />

          <div className="relative">
            <HugeiconsIcon
              icon={Search01Icon}
              className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              placeholder="بحث بالبريد أو اسم المستخدم"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-full ps-8 text-sm border-border/50 bg-muted/50 sm:w-[240px]"
            />
          </div>

          <FacetFilter
            label="الباقة"
            icon={PackageIcon}
            value={tierFilter}
            options={tierOptions}
            onChange={setTierFilter}
          />
          <FacetFilter
            label="الحالة"
            icon={SlidersHorizontalIcon}
            value={statusFilter}
            options={statusOptions}
            onChange={setStatusFilter}
          />
          <FacetFilter
            label="الاشتراك"
            icon={CreditCardIcon}
            value={subFilter}
            options={subOptions}
            onChange={setSubFilter}
          />

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="tap-target-expand h-8"
              onClick={clearFilters}
            >
              مسح كل عوامل التصفية
            </Button>
          )}
        </div>

        {/* A real navigation, so it stays an anchor: routing `Button` through
            `render` would strip link semantics for `role="button"`. */}
        <a
          href="/console/platform?tab=users"
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "tap-target-expand h-8 gap-1.5 self-start sm:self-auto",
          )}
        >
          <HugeiconsIcon icon={UserMultiple02Icon} className="size-3.5" />
          <span>إدارة المستخدمين</span>
        </a>
      </div>

      {/* ≥640px: the table, vertically bounded so the sticky header earns its keep. */}
      <TableWrap maxHeight="max-h-[32rem]" className="hidden sm:block">
        <AdminTable>
          <THead sticky>
            <tr>
              <Th
                className="min-w-[240px]"
                aria-sort={ariaSort(sortKey === "email", sortDir)}
              >
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={allOnPageSelected}
                    onCheckedChange={() => toggleSelectAll(pageIds)}
                    aria-label="تحديد كل الصفوف في هذه الصفحة"
                    className="tap-target-expand border-border/50 bg-background/70"
                  />
                  <SortableHead label="البريد" icon={Mail01Icon} sortKey="email" />
                </div>
              </Th>
              <Th>
                <StaticHead label="المستخدم" icon={UserIcon} />
              </Th>
              <SortableTableHead label="الحالة" icon={Activity01Icon} sortKey="status" />
              <SortableTableHead label="الباقة" icon={PackageIcon} sortKey="tier" />
              <Th>
                <StaticHead label="حالة الاشتراك" icon={CreditCardIcon} />
              </Th>
              <SortableTableHead
                label="التسجيل"
                icon={Calendar01Icon}
                sortKey="created_at_ms"
              />
              {moneyVisible && (
                <Th>
                  <StaticHead label="الرصيد" icon={Wallet01Icon} />
                </Th>
              )}
              <SortableTableHead label="الطلبات" icon={FlashIcon} sortKey="events" />
              {moneyVisible && (
                <SortableTableHead
                  label="التكلفة"
                  icon={ServerStack01Icon}
                  sortKey="provider_cost_usd"
                />
              )}
              {moneyVisible && (
                <Th>
                  <StaticHead label="الاستهلاك" icon={Invoice01Icon} />
                </Th>
              )}
              {profitVisible && (
                <SortableTableHead
                  label="الإيراد"
                  icon={CoinsDollarIcon}
                  sortKey="revenue_usd"
                />
              )}
              {profitVisible && (
                <SortableTableHead
                  label="الربح"
                  icon={MoneyBag02Icon}
                  sortKey="profit_usd"
                />
              )}
              <SortableTableHead
                label="آخر نشاط"
                icon={Activity01Icon}
                sortKey="last_event_ms"
              />
            </tr>
          </THead>

          <tbody>
            {loading ? (
              <TableSkeletonRows rows={6} cols={columnCount} />
            ) : filtered.length === 0 ? (
              <TableEmptyRow
                colSpan={columnCount}
                title={
                  rows.length === 0
                    ? "لا توجد بيانات مستخدمين بعد"
                    : "لا يوجد مستخدم مطابق"
                }
                description={
                  rows.length === 0
                    ? undefined
                    : "لا يوجد مستخدم مطابق لعوامل التصفية الحالية."
                }
              />
            ) : (
              pageRows.map((row) => {
                const isSelected = selected.includes(row.user_id);
                return (
                  <Tr
                    key={row.user_id}
                    className="data-[state=selected]:bg-muted"
                    data-state={isSelected ? "selected" : undefined}
                  >
                    <Td className="max-w-[280px]">
                      <div className="flex items-center gap-2.5">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelect(row.user_id)}
                          aria-label={`تحديد ${row.email}`}
                          className="tap-target-expand border-border/50 bg-background/70"
                        />
                        <span dir="ltr" title={row.email} className="truncate text-sm font-medium">
                          {row.email}
                        </span>
                      </div>
                    </Td>

                    <Td className="max-w-[160px]">
                      <span dir="ltr" className="block truncate text-sm text-muted-foreground">
                        {row.username ? `@${row.username}` : EM_DASH}
                      </span>
                    </Td>

                    <Td>
                      <span className={cn("text-sm", statusToneClass(row.status))}>
                        {userStatusLabelAr(row.status)}
                      </span>
                    </Td>

                    <Td>
                      <span className="text-sm">{tierLabelAr(row.tier)}</span>
                    </Td>

                    <Td>
                      <span
                        className={cn(
                          "text-sm",
                          row.sub_status === "active"
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {subStatusLabelAr(row.sub_status)}
                      </span>
                    </Td>

                    <Td>
                      <span className="text-sm text-muted-foreground">
                        {formatDate(row.created_at_ms)}
                      </span>
                    </Td>

                    {moneyVisible && (
                      <Td>
                        <span className="text-sm tabular-nums" dir="ltr">
                          {formatUsd(row.balance_usd)}
                        </span>
                      </Td>
                    )}

                    <Td>
                      <span className="text-sm tabular-nums" dir="ltr">
                        {formatInt(row.events)}
                      </span>
                    </Td>

                    {moneyVisible && (
                      <Td>
                        <span className="text-sm tabular-nums" dir="ltr">
                          {formatUsd(row.provider_cost_usd)}
                        </span>
                      </Td>
                    )}

                    {moneyVisible && (
                      <Td>
                        <span className="text-sm tabular-nums text-muted-foreground" dir="ltr">
                          {formatUsd(row.retail_burn_usd)}
                        </span>
                      </Td>
                    )}

                    {profitVisible && (
                      <Td>
                        <span className="text-sm tabular-nums" dir="ltr">
                          {formatUsd(row.revenue_usd)}
                        </span>
                      </Td>
                    )}

                    {profitVisible && (
                      <Td>
                        <span
                          className={cn(
                            "text-sm font-medium tabular-nums",
                            row.profit_usd < 0 ? "text-sell" : "text-buy",
                          )}
                          dir="ltr"
                        >
                          {formatUsd(row.profit_usd)}
                        </span>
                      </Td>
                    )}

                    <Td>
                      <span className="text-sm text-muted-foreground">
                        {row.last_event_ms === null ? EM_DASH : formatDate(row.last_event_ms)}
                      </span>
                    </Td>
                  </Tr>
                );
              })
            )}
          </tbody>
        </AdminTable>
      </TableWrap>

      {/* <640px: the same page of rows as labelled cards — never a squashed grid. */}
      <div className="space-y-3 p-3 sm:hidden">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="space-y-2 rounded-[var(--radius-lg)] border border-border bg-card p-3.5"
            >
              <SkeletonLine width="w-40" />
              <SkeletonLine width="w-24" />
            </div>
          ))
        ) : filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {rows.length === 0
              ? "لا توجد بيانات مستخدمين بعد."
              : "لا يوجد مستخدم مطابق لعوامل التصفية الحالية."}
          </p>
        ) : (
          pageRows.map((row, i) => {
            const isSelected = selected.includes(row.user_id);
            const fields: { label: string; value: ReactNode }[] = [
              { label: "الباقة", value: tierLabelAr(row.tier) },
              { label: "حالة الاشتراك", value: subStatusLabelAr(row.sub_status) },
              { label: "التسجيل", value: formatDate(row.created_at_ms) },
              {
                label: "الطلبات",
                value: (
                  <span dir="ltr" className="tabular-nums">
                    {formatInt(row.events)}
                  </span>
                ),
              },
            ];
            if (moneyVisible) {
              fields.push(
                {
                  label: "الرصيد",
                  value: (
                    <span dir="ltr" className="tabular-nums">
                      {formatUsd(row.balance_usd)}
                    </span>
                  ),
                },
                {
                  label: "التكلفة",
                  value: (
                    <span dir="ltr" className="tabular-nums">
                      {formatUsd(row.provider_cost_usd)}
                    </span>
                  ),
                },
              );
            }
            if (profitVisible) {
              fields.push(
                {
                  label: "الإيراد",
                  value: (
                    <span dir="ltr" className="tabular-nums">
                      {formatUsd(row.revenue_usd)}
                    </span>
                  ),
                },
                {
                  label: "الربح",
                  value: (
                    <span
                      dir="ltr"
                      className={cn(
                        "font-medium tabular-nums",
                        row.profit_usd < 0 ? "text-sell" : "text-buy",
                      )}
                    >
                      {formatUsd(row.profit_usd)}
                    </span>
                  ),
                },
              );
            }
            fields.push({
              label: "آخر نشاط",
              value: row.last_event_ms === null ? EM_DASH : formatDate(row.last_event_ms),
            });

            return (
              <RecordCard
                key={row.user_id}
                index={i}
                title={
                  <span dir="ltr" title={row.email} className="block truncate text-start">
                    {row.email}
                  </span>
                }
                subtitle={
                  row.username ? (
                    <span dir="ltr" className="block truncate text-start">
                      @{row.username}
                    </span>
                  ) : undefined
                }
                badge={
                  <span className={cn("text-xs", statusToneClass(row.status))}>
                    {userStatusLabelAr(row.status)}
                  </span>
                }
                fields={fields}
                actions={
                  <label className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleSelect(row.user_id)}
                      aria-label={`تحديد ${row.email}`}
                      className="tap-target-expand border-border/50 bg-background/70"
                    />
                    <span>تحديد للحساب الجماعي</span>
                  </label>
                }
              />
            );
          })
        )}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-muted/30 px-4 py-2.5 text-sm">
          <span className="font-medium">
            محدد: {formatInt(selected.length)} مستخدم
          </span>
          {profitVisible && (
            <>
              <span className="text-muted-foreground">
                الإيراد{" "}
                <span dir="ltr" className="tabular-nums text-foreground">
                  {formatUsd(selectedTotals.revenue)}
                </span>
              </span>
              <span className="text-muted-foreground">
                الربح{" "}
                <span
                  dir="ltr"
                  className={cn(
                    "tabular-nums",
                    selectedTotals.profit < 0 ? "text-sell" : "text-buy",
                  )}
                >
                  {formatUsd(selectedTotals.profit)}
                </span>
              </span>
            </>
          )}
          {moneyVisible && (
            <span className="text-muted-foreground">
              التكلفة{" "}
              <span dir="ltr" className="tabular-nums text-foreground">
                {formatUsd(selectedTotals.cost)}
              </span>
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="tap-target-expand h-7 ms-auto"
            onClick={() => toggleSelectAll(selected)}
          >
            إلغاء التحديد
          </Button>
        </div>
      )}

      <div className="flex flex-col items-center justify-between gap-4 border-t border-border px-4 py-3 sm:flex-row">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            عرض {formatInt(filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1)} إلى{" "}
            {formatInt(Math.min(safePage * pageSize, filtered.length))} من{" "}
            {formatInt(filtered.length)} مستخدم
          </span>
          <div className="hidden h-4 w-px bg-border sm:block" />
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline">عرض</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                const next = Number(value);
                if (next === 10 || next === 25 || next === 50) setPageSize(next);
              }}
            >
              <SelectTrigger className="h-8 w-[76px] bg-muted/50" aria-label="عدد الصفوف">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="hidden sm:inline">لكل صفحة</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            className="tap-target-expand"
            aria-label="الصفحة الأولى"
            onClick={() => setPage(1)}
            disabled={safePage === 1}
          >
            <HugeiconsIcon icon={ArrowLeftDoubleIcon} className="size-4 rtl:rotate-180" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="tap-target-expand"
            aria-label="الصفحة السابقة"
            onClick={() => setPage(safePage - 1)}
            disabled={safePage === 1}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4 rtl:rotate-180" />
          </Button>

          <div className="mx-2 flex items-center gap-1">
            {pageNumbers.map((pageNum) => (
              <Button
                key={pageNum}
                variant={safePage === pageNum ? "default" : "outline"}
                size="icon-sm"
                className="tap-target-expand tabular-nums"
                aria-current={safePage === pageNum ? "page" : undefined}
                onClick={() => setPage(pageNum)}
              >
                {pageNum}
              </Button>
            ))}
          </div>

          <Button
            variant="outline"
            size="icon-sm"
            className="tap-target-expand"
            aria-label="الصفحة التالية"
            onClick={() => setPage(safePage + 1)}
            disabled={safePage === totalPages}
          >
            <HugeiconsIcon icon={ArrowRight01Icon} className="size-4 rtl:rotate-180" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="tap-target-expand"
            aria-label="الصفحة الأخيرة"
            onClick={() => setPage(totalPages)}
            disabled={safePage === totalPages}
          >
            <HugeiconsIcon icon={ArrowRightDoubleIcon} className="size-4 rtl:rotate-180" />
          </Button>
        </div>
      </div>
    </div>
  );
}
