import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { activeNav, APP_NAV, ADMIN_NAV, navForRole } from "@/components/shell/navConfig";

const root = resolve(process.cwd(), "src");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

test("APP_NAV has Chart/Chat, unified Performance, Journal — no Chat History page", () => {
  const userHrefs = navForRole("user", "full").map((i) => i.href);
  assert.deepEqual(userHrefs, [
    "/workspace",
    "/performance",
    "/journal",
    "/console/billing",
    "/console/support",
  ]);
  assert.ok(!userHrefs.includes("/console/chats"));
  assert.ok(!APP_NAV.some((i) => i.labelKey === "nav.chat_history"));
});

test("old recommendation/trade/statistics routes redirect into /performance", () => {
  assert.match(read("app/statistics/page.tsx"), /redirect\("\/performance#statistics"\)/);
  assert.match(read("app/recommendations/page.tsx"), /redirect\("\/performance#recommendations"\)/);
  assert.match(read("app/console/trades/page.tsx"), /redirect\("\/performance#trades"\)/);
  // The unified page hosts all three sections.
  const page = read("app/performance/page.tsx");
  assert.match(page, /RecommendationsSection/);
  assert.match(page, /StatisticsSection/);
  assert.match(page, /TradesClient/);
});

test("trial nav is limited to the workspace only", () => {
  assert.deepEqual(
    navForRole("user", "trial").map((i) => i.href),
    ["/workspace"],
  );
});

test("admin nav is dedicated and excludes trader destinations", () => {
  const adminHrefs = navForRole("admin").map((i) => i.href);
  // The admin's home is the platform overview, not the trader bridge at /workspace.
  assert.ok(!adminHrefs.includes("/workspace"));
  assert.ok(adminHrefs.includes("/console/platform?tab=overview"));
  assert.ok(adminHrefs.every((h) => h.startsWith("/console/platform")));
  assert.match(read("app/workspace/page.tsx"), /redirect\("\/console\/platform\?tab=overview"\)/);
  assert.ok(!adminHrefs.includes("/statistics"));
  assert.ok(!adminHrefs.includes("/console/trades"));
  assert.deepEqual(navForRole("admin"), ADMIN_NAV);
  assert.ok(!ADMIN_NAV.some((i) => i.labelKey === "nav.workspace"));
});

test("Account, Integrations, Settings are not primary destinations", () => {
  const hrefs = new Set([...APP_NAV, ...ADMIN_NAV].map((i) => i.href));
  for (const hidden of ["/console/account", "/console/connect", "/console/settings", "/console/chats"]) {
    assert.equal(hrefs.has(hidden), false, hidden);
  }
});

test("activeNav exact vs prefix", () => {
  const overview = APP_NAV.find((i) => i.href === "/workspace")!;
  const performance = APP_NAV.find((i) => i.href === "/performance")!;
  assert.equal(activeNav("/workspace", overview), true);
  assert.equal(activeNav("/performance", overview), false);
  assert.equal(activeNav("/performance", performance), true);
});

test("shell mounts conversations for traders; admin uses admin nav", () => {
  const shell = read("components/shell/AppConsoleShell.tsx");
  assert.match(shell, /SidebarConversations/);
  assert.match(shell, /canonical-desktop-sidebar/);
  assert.match(shell, /canonical-mobile-drawer/);
  assert.match(shell, /canonical-admin-nav|navForRole/);
  assert.match(shell, /ShellMenuProvider/);
  assert.equal((shell.match(/data-testid="canonical-desktop-sidebar"/g) ?? []).length, 1);
  // Floating overlay hamburger removed from shell — chart toolbar / page header host it.
  assert.doesNotMatch(shell, /fixed start-3 top-3 z-30/);
  assert.doesNotMatch(shell, /glass-panel/);
});

test("both consoles share one top bar: account, alerts, nav", () => {
  const shell = read("components/shell/AppConsoleShell.tsx");
  assert.match(shell, /<ConsoleTopBar/);
  assert.doesNotMatch(shell, /needsPageMenu/);
  // Traders refresh from the library header button; admin page refresh stays in the top bar.
  assert.match(shell, /refreshMode=\{isAdmin \? "page" : "none"\}/);
  assert.match(
    read("components/chart/TvChart.tsx"),
    /setAttribute\(\s*"data-testid"\s*,\s*"chart-refresh"\s*\)/,
  );
  assert.match(read("components/shell/ConsoleTopBar.tsx"), /data-testid="topbar-scroll"/);
  // Read past the imports so the order below is the rendered order, not the
  // import order.
  const bar = read("components/shell/ConsoleTopBar.tsx").split('data-testid="console-top-bar"')[1]!;
  // Drawer trigger pinned; scroll cluster holds the rest; avatar at the end.
  const order = [
    "mobile-menu-trigger",
    "topbar-scroll",
    "NotificationCenter",
    "SidebarProfileMenu",
  ];
  let cursor = -1;
  for (const marker of order) {
    const at = bar.indexOf(marker);
    assert.ok(at > cursor, marker);
    cursor = at;
  }
  // The admin console had its own header carrying the same three controls.
  const adminHeader = read("components/admin/chrome/AdminHeader.tsx");
  assert.doesNotMatch(adminHeader, /ThemeToggle|window\.location\.reload/);
  assert.doesNotMatch(adminHeader, /sticky/);
});

test("subscription credit chip renders regardless of billing enforcement flag", () => {
  const chip = read("components/shell/BalanceChip.tsx");
  assert.doesNotMatch(chip, /!state\.enforced\) return null/);
  assert.match(chip, /formatUsd\(state\.totalUsd\)/);
  assert.match(chip, /data-balance-state=\{empty \? "empty"/);
});

test("MT equity chip renders zero balances from hook", () => {
  const hook = read("hooks/useAccountCapital.ts");
  assert.doesNotMatch(hook, /equity > 0/);
  const bar = read("components/shell/TopBarAccountStatus.tsx");
  // Same formatter as the subscription-credit chip — a real zero must render
  // as "$0.00" in both, not one "$0.00" beside a rounded "$0" that reads as
  // the other value being broken.
  assert.match(bar, /formatUsd\(capital\.amount\)/);
  assert.doesNotMatch(bar, /formatUsdWhole/);
  assert.match(bar, /data-equity-state="ready"/);
});

test("risk per trade is a composer control, not a settings section", () => {
  const settings = read("components/SettingsClient.tsx");
  assert.doesNotMatch(settings, /id: "trading"/);
  const input = read("components/agent/AgentChatInput.tsx");
  assert.match(input, /RiskPerTradeControl/);
  // Both open on the one shared composer surface.
  const risk = read("components/agent/RiskPerTradeControl.tsx");
  assert.match(risk, /ComposerPopover/);
});

test("model and execution mode live behind the composer's plus", () => {
  const input = read("components/agent/AgentChatInput.tsx");
  assert.match(input, /ComposerMoreMenu/);
  // The chips they replaced are gone from the row itself.
  assert.doesNotMatch(input, /AgentModelPicker/);
  const menu = read("components/agent/ComposerMoreMenu.tsx");
  assert.match(menu, /data-testid="composer-more"/);
  assert.match(menu, /ComposerPopover/);
  assert.match(menu, /ModelChoiceList/);
  assert.match(menu, /data-testid="composer-execution-mode"/);
  // Execution authority is never one tap, and never offered while offline.
  assert.match(menu, /view\?\.connected/);
  assert.match(menu, /setConfirming\(true\)/);
  assert.match(menu, /trade_mode\.confirm\.body/);
  // Mode/account state also live in the top bar; the composer + menu keeps the switch.
  assert.match(read("components/shell/TopBarAccountStatus.tsx"), /useTradeMode/);
  const hook = read("hooks/useTradeMode.ts");
  assert.match(hook, /confirmed_by_user: true/);
});

test("pair picker is a card catalogue with flags, quotes and live search", () => {
  const sheet = read("components/agent/SymbolPickerSheet.tsx");
  // Two columns on a phone, four on a desktop — the requested responsive grid.
  assert.match(sheet, /grid-cols-2 gap-2 lg:grid-cols-4/);
  assert.match(sheet, /data-testid="symbol-picker-search"/);
  assert.match(sheet, /data-testid="pair-card"/);
  assert.match(sheet, /PairFlags/);
  assert.match(sheet, /sparklineGeometry/);
  assert.match(sheet, /IntersectionObserver/);
  // It is a change of surface, so it takes the one sheet slot.
  const pickers = read("components/agent/ComposerMarketPickers.tsx");
  assert.match(pickers, /useSheetSlot\("symbolPicker"\)/);
  assert.match(pickers, /PairFlags/);
  // Flags are served from the app, never from a third-party CDN.
  const flags = read("components/agent/CurrencyFlag.tsx");
  assert.doesNotMatch(flags, /https?:\/\//);
  assert.match(flags, /currencyMark/);
});

test("billing page reads from the dictionaries, not hardcoded Arabic", () => {
  const billing = read("components/billing/BillingClient.tsx");
  assert.match(billing, /useLocale/);
  assert.doesNotMatch(billing, /[\u0600-\u06FF]/);
});

test("old /console/chats route redirects to the workspace", () => {
  const page = read("app/console/chats/page.tsx");
  assert.match(page, /redirect\("\/workspace"\)/);
  assert.doesNotMatch(page, /SidebarConversations|ChatHistoryPage/);
});

test("chat share route redirects to the workspace with chat query", () => {
  const page = read("app/console/chats/[chatId]/page.tsx");
  assert.match(page, /chatConsoleHref/);
  assert.match(page, /isValidChatId/);
});

test("workspace syncs chat selection to URL", () => {
  const workspace = read("components/SmartChartWorkspace.tsx");
  assert.match(workspace, /useConsoleChatUrl/);
  assert.match(workspace, /syncChatUrl/);
  assert.match(workspace, /skipUrlSync/);
});

test("sidebar opens chats via chatConsoleHref", () => {
  const sidebar = read("components/shell/SidebarConversations.tsx");
  assert.match(sidebar, /chatConsoleHref/);
  assert.match(sidebar, /useSearchParams/);
});

test("workspace shows the chart as a sheet under xl, a pane from xl", () => {
  const workspace = read("components/SmartChartWorkspace.tsx");
  assert.doesNotMatch(workspace, /FloatingWorkspaceSwitcher/);
  assert.doesNotMatch(workspace, /role="tablist"/);
  assert.equal((workspace.match(/<AgentChatSidebar/g) ?? []).length, 0);
  // One chart node for both regimes: remounting it would drop every drawing.
  assert.equal((workspace.match(/<TvChart\b/g) ?? []).length, 1);
  assert.match(workspace, /data-chart-pane/);
  assert.match(workspace, /bottom-0 z-40/);
  assert.match(workspace, /useSheetSlot\("chart"\)/);
});

test("one overlay at a time across drawer, account sheet and chart sheet", () => {
  const coordinator = read("components/shell/SheetCoordinator.tsx");
  assert.match(coordinator, /activeSheet/);
  const shell = read("components/shell/AppConsoleShell.tsx");
  assert.match(shell, /useSheetSlot\("sidebarDrawer"\)/);
  assert.match(shell, /SheetCoordinatorProvider/);
  const profile = read("components/agent/SidebarProfileMenu.tsx");
  assert.match(profile, /useSheetSlot\("profileMenu"\)/);
});

test("language switching lives in one place", () => {
  const shell = read("components/shell/AppConsoleShell.tsx");
  // The rail and the drawer both carried their own switcher; the account menu
  // reached from the top bar is now the only one.
  assert.doesNotMatch(shell, /LanguageSwitcher/);
  const profile = read("components/agent/SidebarProfileMenu.tsx");
  assert.match(profile, /profile\.language/);
  assert.match(profile, /variant === "topbar"/);
});

test("settings opens over the workspace instead of navigating away", () => {
  const profile = read("components/agent/SidebarProfileMenu.tsx");
  assert.match(profile, /openSettings\(\)/);
  assert.doesNotMatch(profile, /router\.push\("\/console\/settings"\)/);
  const modal = read("components/SettingsModal.tsx");
  assert.match(modal, /@base-ui\/react\/dialog/);
  assert.match(modal, /settings\.unsaved_title/);
});

test("collapsed rail brand expands the sidebar and does not navigate", () => {
  const shell = read("components/shell/AppConsoleShell.tsx");
  assert.match(shell, /data-testid="sidebar-expand-brand"/);
  assert.match(shell, /group-focus-visible:opacity-100/);
});

test("composer stacks the text over controls and ends in one adaptive slot", () => {
  const input = read("components/agent/AgentChatInput.tsx");
  // The chart toggle left the composer for the top bar; the mic stopped being a
  // permanent icon — stop while running, send once typed, voice when empty.
  assert.doesNotMatch(input, /composer-chart-toggle/);
  assert.match(input, /running \?/);
  assert.match(input, /value\.trim\(\) \?/);
  assert.match(input, /voiceControl \?\?/);
  // Logical alignment only, so the row mirrors under dir="rtl".
  assert.match(input, /ms-auto/);
  assert.doesNotMatch(input, /\bml-auto\b|\bmr-auto\b/);
  const topBar = read("components/shell/ConsoleTopBar.tsx");
  assert.match(topBar, /data-testid="topbar-chart-toggle"/);
  assert.match(topBar, /CHART_TOGGLE_EVENT/);
});

test("composer has bottom fade; upper chat shadow removed", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.chat-composer-fade/);
  assert.match(css, /var\(--background\)/);
  assert.doesNotMatch(css, /#7c3aed|#8b5cf6|#bc00ff/);
  assert.doesNotMatch(css, /\.chat-scroll-region::before/);
  const input = read("components/agent/AgentChatInput.tsx");
  assert.match(input, /chat-composer-shell/);
  const panel = read("components/agent/SmartChartAgentPanel.tsx");
  assert.match(panel, /composer-fade|chat-composer-fade/);
  assert.match(panel, /chat-panel-shell/);
});

test("profile menu uses opaque portal surface", () => {
  const menu = read("components/agent/SidebarProfileMenu.tsx");
  assert.match(menu, /createPortal/);
  assert.match(menu, /sidebar-profile-popover/);
  assert.match(menu, /backgroundColor: "var\(--background\)"/);
  assert.match(menu, /\/console\/account/);
  // Settings is an overlay now, not a destination — see the settings test below.
  assert.match(menu, /openSettings/);
  assert.match(menu, /data-testid="theme-toggle"/);
});

test("brand mark viewBox remains unclipped", () => {
  const mark = readFileSync(resolve(process.cwd(), "public/brand/aichart-mark.svg"), "utf8");
  assert.match(mark, /viewBox="0 350 3000 2250"/);
});

test("auth form prevents mobile horizontal overflow", () => {
  const auth = read("components/AuthForm.tsx");
  assert.match(auth, /max-w-\[100vw\]/);
  assert.match(auth, /overflow-x-hidden/);
  assert.match(auth, /overflow-hidden bg-background/);
  assert.match(auth, /min-w-0 max-w-full/);
});

test("MCP login uses neutral tokens and preserves oauth routes", () => {
  const login = readFileSync(resolve(process.cwd(), "../mcp/src/auth/login.ts"), "utf8");
  assert.match(login, /prefers-color-scheme: dark/);
  assert.match(login, /viewBox="100 250 900 670"/);
  assert.match(login, /action="\/oauth\/login"/);
  assert.match(login, /verifyPlatformUser/);
});

test("shell-less pages still use AppConsoleShell", () => {
  assert.match(read("app/performance/layout.tsx"), /AppConsoleShell/);
  assert.match(read("app/recommendations/layout.tsx"), /AppConsoleShell/);
});

test("legacy shells stay deleted", () => {
  for (const legacy of [
    "components/user/UserShell.tsx",
    "components/bridge/BridgeShell.tsx",
    "components/Nav.tsx",
  ]) {
    assert.ok(!existsSync(resolve(root, legacy)), legacy);
  }
});
