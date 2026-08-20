import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { activeNav, APP_NAV, navForRole } from "@/components/shell/navConfig";
import { adminGroupsFor } from "@/components/admin/chrome/adminNavTree";

const root = resolve(process.cwd(), "src");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

test("APP_NAV is the three product surfaces and nothing else", () => {
  assert.deepEqual(
    APP_NAV.map((i) => i.href),
    ["/chat", "/recommendations", "/performance"],
  );
});


test("trial nav is limited to the workspace only", () => {
  assert.deepEqual(
    navForRole("user", "trial").map((i) => i.href),
    ["/chat"],
  );
});


test("Account, Integrations, Settings are not primary destinations", () => {
  // The admin hrefs come from the tree the rail actually renders
  // (adminGroupsFor) — the parallel ADMIN_NAV list this test used to read was
  // dead at runtime and has been deleted.
  const adminHrefs = adminGroupsFor().flatMap((g) =>
    g.items.map((i) => `/console/platform?tab=${i.id}`),
  );
  const hrefs = new Set([...APP_NAV.map((i) => i.href), ...adminHrefs]);
  for (const hidden of ["/console/account", "/console/connect", "/console/settings", "/console/chats"]) {
    assert.equal(hrefs.has(hidden), false, hidden);
  }
});

test("activeNav exact vs prefix", () => {
  const overview = APP_NAV.find((i) => i.href === "/chat")!;
  const performance = APP_NAV.find((i) => i.href === "/performance")!;
  assert.equal(activeNav("/chat", overview), true);
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

test("both consoles share one top bar: account and nav", () => {
  const shell = read("components/shell/AppConsoleShell.tsx");
  assert.match(shell, /<ConsoleTopBar/);
  assert.doesNotMatch(shell, /needsPageMenu/);
  // Library header is hidden; traders refresh candles from the top bar.
  assert.match(shell, /refreshMode=\{isAdmin \? "page" : "chart"\}/);
  assert.match(
    read("components/shell/ConsoleTopBar.tsx"),
    /data-testid=\{refreshMode === "chart" \? "chart-refresh" : "console-refresh"\}/,
  );
  assert.match(read("components/shell/ConsoleTopBar.tsx"), /data-testid="topbar-scroll"/);
  // Read past the imports so the order below is the rendered order, not the
  // import order.
  const bar = read("components/shell/ConsoleTopBar.tsx").split('data-testid="console-top-bar"')[1]!;
  // Drawer trigger pinned; scroll cluster holds the rest; avatar at the end.
  const order = [
    "mobile-menu-trigger",
    "topbar-scroll",
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


test("risk per trade is a composer control, not a settings section", () => {
  const settings = read("components/SettingsClient.tsx");
  assert.doesNotMatch(settings, /id: "trading"/);
  const input = read("components/agent/AgentChatInput.tsx");
  assert.match(input, /RiskPerTradeControl/);
  // Both open on the one shared composer surface.
  const risk = read("components/agent/RiskPerTradeControl.tsx");
  assert.match(risk, /ComposerPopover/);
});



test("billing page reads from the dictionaries, not hardcoded Arabic", () => {
  const billing = read("components/billing/BillingClient.tsx");
  assert.match(billing, /useLocale/);
  assert.doesNotMatch(billing, /[\u0600-\u06FF]/);
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
  assert.doesNotMatch(workspace, /cursor-col-resize/);
  assert.doesNotMatch(workspace, /startChatResize/);
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

test("settings from the account menu is a real path with the overlay chrome", () => {
  const profile = read("components/agent/SidebarProfileMenu.tsx");
  assert.match(profile, /openSettings\(\)/);
  const shell = read("components/shell/AppConsoleShell.tsx");
  assert.match(shell, /settingsPath/);
  assert.match(shell, /router\.push\(settingsPath/);
  assert.match(shell, /rememberSettingsReturn/);
  assert.doesNotMatch(shell, /SettingsModal/);
  assert.equal(existsSync(resolve(root, "components/SettingsModal.tsx")), false);
  const client = read("components/SettingsClient.tsx");
  assert.match(client, /data-testid="settings-modal"/);
  assert.match(client, /href=\{settingsPath\(item\.id\)\}/);
  assert.match(client, /\breplace\b/);
  assert.match(client, /takeSettingsReturn/);
  assert.doesNotMatch(client, /router\.back\(/);
  assert.match(client, /settings\.unsaved_title/);
});

test("collapsed rail brand expands the sidebar and does not navigate", () => {
  const shell = read("components/shell/AppConsoleShell.tsx");
  assert.match(shell, /data-testid="sidebar-expand-brand"/);
  assert.match(shell, /group-focus-visible:opacity-100/);
});


test("docked composer keeps a fade wall and live thread padding", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.chat-composer-fade/);
  assert.match(css, /\.chat-panel-shell\s*>\s*\.chat-composer-dock/);
  assert.match(css, /--composer-height/);
  assert.doesNotMatch(css, /#7c3aed|#8b5cf6|#bc00ff/);
  assert.doesNotMatch(css, /\.chat-scroll-region::before/);
  const input = read("components/agent/AgentChatInput.tsx");
  assert.match(input, /chat-composer-shell/);
  const panel = read("components/agent/SmartChartAgentPanel.tsx");
  assert.match(panel, /composer-fade|chat-composer-fade/);
  assert.match(panel, /chat-panel-shell/);
  assert.match(panel, /data-hero=\{isHero/);
});

test("profile menu uses opaque portal surface", () => {
  const menu = read("components/agent/SidebarProfileMenu.tsx");
  assert.match(menu, /createPortal/);
  assert.match(menu, /sidebar-profile-popover/);
  assert.match(menu, /backgroundColor: "var\(--background\)"/);
  assert.match(menu, /\/console\/account/);
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
  // `mcp/` is a subproject of this repository, not a sibling of it — the
  // `../` dates from when the app lived in a `web/` subdirectory. Both shapes
  // are tried so the assertion runs instead of dying on ENOENT.
  const loginPath =
    [
      resolve(process.cwd(), "mcp/src/auth/login.ts"),
      resolve(process.cwd(), "../mcp/src/auth/login.ts"),
    ].find(existsSync) ?? resolve(process.cwd(), "mcp/src/auth/login.ts");
  const login = readFileSync(loginPath, "utf8");
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
