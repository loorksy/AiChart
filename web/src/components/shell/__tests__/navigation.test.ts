import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { activeNav, APP_NAV, navForRole } from "@/components/shell/navConfig";

const root = resolve(process.cwd(), "src");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

test("APP_NAV has Chart/Chat, Statistics, Trades — no Chat History page", () => {
  const userHrefs = navForRole("user").map((i) => i.href);
  assert.deepEqual(userHrefs, ["/console", "/statistics", "/console/trades"]);
  assert.ok(!userHrefs.includes("/console/chats"));
  assert.ok(!APP_NAV.some((i) => i.labelKey === "nav.chat_history"));
});

test("Account, Integrations, Settings are not primary destinations", () => {
  const hrefs = new Set(APP_NAV.map((i) => i.href));
  for (const hidden of ["/console/account", "/console/connect", "/console/settings", "/console/chats"]) {
    assert.equal(hrefs.has(hidden), false, hidden);
  }
});

test("admin platform remains admin-only", () => {
  assert.ok(!navForRole("user").some((i) => i.href.includes("/console/platform")));
  assert.ok(navForRole("admin").some((i) => i.href === "/console/platform"));
});

test("activeNav exact vs prefix", () => {
  const overview = APP_NAV.find((i) => i.href === "/console")!;
  const trades = APP_NAV.find((i) => i.href === "/console/trades")!;
  assert.equal(activeNav("/console", overview), true);
  assert.equal(activeNav("/console/trades", overview), false);
  assert.equal(activeNav("/console/trades", trades), true);
});

test("shell mounts conversations inside one sidebar/drawer", () => {
  const shell = read("components/shell/AppConsoleShell.tsx");
  assert.match(shell, /SidebarConversations/);
  assert.match(shell, /canonical-desktop-sidebar/);
  assert.match(shell, /canonical-mobile-drawer/);
  assert.match(shell, /mobile-menu-trigger/);
  assert.equal((shell.match(/data-testid="canonical-desktop-sidebar"/g) ?? []).length, 1);
  assert.equal((shell.match(/data-testid="mobile-menu-trigger"/g) ?? []).length, 1);
  assert.doesNotMatch(shell, /glass-panel/);
});

test("old /console/chats route redirects to console", () => {
  const page = read("app/console/chats/page.tsx");
  assert.match(page, /redirect\("\/console"\)/);
  assert.doesNotMatch(page, /SidebarConversations|ChatHistoryPage/);
});

test("workspace uses floating switcher once; no top tab bar", () => {
  const workspace = read("components/SmartChartWorkspace.tsx");
  assert.match(workspace, /import \{ FloatingWorkspaceSwitcher \}/);
  assert.equal((workspace.match(/<FloatingWorkspaceSwitcher\b/g) ?? []).length, 1);
  assert.doesNotMatch(workspace, /h-10 shrink-0 items-center justify-center/);
  assert.doesNotMatch(workspace, /role="tablist"/);
  assert.equal((workspace.match(/<AgentChatSidebar/g) ?? []).length, 0);
});

test("floating switcher defaults by locale edge helpers", () => {
  const switcher = read("components/workspace/FloatingWorkspaceSwitcher.tsx");
  assert.match(switcher, /data-testid="chart-chat-switcher"/);
  assert.match(switcher, /defaultSwitcherPosition|loadSwitcherPosition/);
  assert.match(switcher, /SWITCHER_DRAG_THRESHOLD/);
  const helpers = read("lib/layout/workspaceSwitcher.ts");
  assert.match(helpers, /dir === "rtl" \? "left" : "right"/);
});

test("composer has no outer footer container; fade is theme-aware", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.chat-composer-fade/);
  assert.match(css, /var\(--background\)/);
  assert.doesNotMatch(css, /#7c3aed|#8b5cf6|#bc00ff/);
  const input = read("components/agent/AgentChatInput.tsx");
  assert.match(input, /chat-composer-shell/);
  assert.doesNotMatch(input, /border-t border-border bg-background/);
  const panel = read("components/agent/SmartChartAgentPanel.tsx");
  assert.match(panel, /composer-fade|chat-composer-fade/);
  assert.match(panel, /chat-panel-shell/);
});

test("profile menu keeps account destinations out of primary nav", () => {
  const menu = read("components/agent/SidebarProfileMenu.tsx");
  assert.match(menu, /\/console\/account/);
  assert.match(menu, /\/console\/settings/);
  assert.match(menu, /data-testid="theme-toggle"/);
});

test("brand mark viewBox remains unclipped", () => {
  const mark = readFileSync(resolve(process.cwd(), "public/brand/aichart-mark.svg"), "utf8");
  assert.match(mark, /viewBox="100 250 900 670"/);
});

test("MCP login uses neutral tokens and preserves oauth routes", () => {
  const login = readFileSync(resolve(process.cwd(), "../mcp/src/auth/login.ts"), "utf8");
  assert.match(login, /prefers-color-scheme: dark/);
  assert.match(login, /viewBox="100 250 900 670"/);
  assert.doesNotMatch(login, /#3b82f6|#0f172a|#2563eb/);
  assert.match(login, /action="\/oauth\/login"/);
  assert.match(login, /verifyPlatformUser/);
  assert.match(login, /Sign in and approve/);
  assert.match(login, /تسجيل الدخول والموافقة/);
  assert.match(login, /detectLoginLocale/);
});

test("shell-less pages still use AppConsoleShell", () => {
  assert.match(read("app/statistics/layout.tsx"), /AppConsoleShell/);
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
