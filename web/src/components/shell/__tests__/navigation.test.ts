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
    "/console",
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

test("trial nav is limited to console only", () => {
  assert.deepEqual(
    navForRole("user", "trial").map((i) => i.href),
    ["/console"],
  );
});

test("admin nav is dedicated and excludes trader destinations", () => {
  const adminHrefs = navForRole("admin").map((i) => i.href);
  assert.ok(adminHrefs.includes("/console"));
  assert.ok(adminHrefs.some((h) => h.includes("/console/platform")));
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
  const overview = APP_NAV.find((i) => i.href === "/console")!;
  const performance = APP_NAV.find((i) => i.href === "/performance")!;
  assert.equal(activeNav("/console", overview), true);
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

test("every console page below lg reaches the drawer from the shell toolbar", () => {
  const shell = read("components/shell/AppConsoleShell.tsx");
  // The workspace used to borrow this trigger from the floating switcher.
  assert.match(shell, /data-testid="mobile-menu-trigger"/);
  assert.equal((shell.match(/data-testid="page-toolbar-menu"/g) ?? []).length, 1);
  assert.doesNotMatch(shell, /needsPageMenu/);
  const workspace = read("components/SmartChartWorkspace.tsx");
  assert.doesNotMatch(workspace, /ChartToolbarMenuButton/);
});

test("old /console/chats route redirects to console", () => {
  const page = read("app/console/chats/page.tsx");
  assert.match(page, /redirect\("\/console"\)/);
  assert.doesNotMatch(page, /SidebarConversations|ChatHistoryPage/);
});

test("chat share route redirects to console with chat query", () => {
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

test("language switching lives in one place on mobile", () => {
  const shell = read("components/shell/AppConsoleShell.tsx");
  // Drawer footer gave it up; the account sheet keeps it.
  assert.equal((shell.match(/languageRow\(/g) ?? []).length, 1);
  const profile = read("components/agent/SidebarProfileMenu.tsx");
  assert.match(profile, /profile\.language/);
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

test("composer stacks the text over its controls and hosts the chart toggle", () => {
  const input = read("components/agent/AgentChatInput.tsx");
  assert.match(input, /data-testid="composer-chart-toggle"/);
  assert.match(input, /aria-pressed=\{chartOpen\}/);
  // Logical alignment only, so the row mirrors under dir="rtl".
  assert.match(input, /ms-auto/);
  assert.doesNotMatch(input, /\bml-auto\b|\bmr-auto\b/);
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
