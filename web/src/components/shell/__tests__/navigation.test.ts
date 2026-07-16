import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { activeNav, APP_NAV, navForRole } from "@/components/shell/navConfig";

const root = resolve(process.cwd(), "src");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

test("APP_NAV is the single navigation source and covers the agent product pages", () => {
  const hrefs = APP_NAV.map((i) => i.href);
  for (const required of [
    "/console",
    "/console/trades",
    "/console/recommendations",
    "/statistics",
    "/console/account",
    "/console/connect",
    "/console/settings",
  ]) {
    assert.ok(hrefs.includes(required), `APP_NAV missing ${required}`);
  }
});

test("admin items are hidden from regular users and visible to admins", () => {
  const user = navForRole("user").map((i) => i.href);
  const admin = navForRole("admin").map((i) => i.href);
  assert.ok(!user.some((href) => href.includes("/console/platform")));
  assert.ok(admin.some((href) => href === "/console/platform"));
  assert.ok(admin.length > user.length);
});

test("activeNav highlights exact, prefix, and tabbed routes correctly", () => {
  const overview = APP_NAV.find((i) => i.href === "/console")!;
  const trades = APP_NAV.find((i) => i.href === "/console/trades")!;

  assert.equal(activeNav("/console", overview), true);
  assert.equal(activeNav("/console/trades", overview), false, "exact item must not match children");
  assert.equal(activeNav("/console/trades", trades), true);
});

test("legacy and internal destinations are absent from daily navigation", () => {
  const hrefs = new Set(APP_NAV.map((item) => item.href));
  for (const hidden of ["/chart", "/recommendations", "/console/risk", "/console/mcp"]) {
    assert.equal(hrefs.has(hidden), false, hidden);
  }
});

test("legacy navigation shells are removed from the tree", () => {
  for (const legacy of [
    "components/user/UserShell.tsx",
    "components/user/userNav.ts",
    "components/bridge/BridgeShell.tsx",
    "components/bridge/bridgeNav.ts",
    "components/Nav.tsx",
    "components/ui/shell/AppHeader.tsx",
  ]) {
    assert.ok(!existsSync(resolve(root, legacy)), `${legacy} must be deleted`);
  }
  // The old ADMIN_NAV constant is gone; only audit labels remain.
  assert.doesNotMatch(read("components/admin/adminNav.ts"), /ADMIN_NAV\s*=/);
});

test("the chart workspace uses the app's single mobile drawer and a top Chart/Chat switch", () => {
  const workspace = read("components/SmartChartWorkspace.tsx");
  const sidebarMounts = workspace.match(/<AgentChatSidebar/g) ?? [];
  assert.equal(sidebarMounts.length, 1, "desktop chat history only; app shell owns the mobile drawer");
  assert.match(workspace, /hidden w-\[240px\] shrink-0 xl:block/);
  assert.doesNotMatch(workspace, /chatSidebarOpen|PanelLeft/);
  assert.match(workspace, /xl:hidden/);
  // No legacy shells imported anywhere in the workspace.
  assert.doesNotMatch(workspace, /UserShell|BridgeShell|ChatGptSidebar/);
});

test("shell-less agent pages now use the unified AppConsoleShell", () => {
  assert.match(read("app/recommendations/layout.tsx"), /AppConsoleShell/);
  assert.match(read("app/statistics/layout.tsx"), /AppConsoleShell/);
});

test("profile menu routes to unified console destinations, not legacy aliases", () => {
  const menu = read("components/agent/SidebarProfileMenu.tsx");
  assert.doesNotMatch(menu, /router\.push\("\/dashboard"\)/);
  assert.doesNotMatch(menu, /router\.push\("\/settings"\)/);
  assert.match(menu, /router\.push\("\/console\/account"\)/);
  assert.match(menu, /router\.push\("\/console\/settings"\)/);
  assert.match(menu, /tab=appearance/);
});

test("authenticated entry and technical MCP routes stay behind canonical destinations", () => {
  const home = read("app/page.tsx");
  assert.match(home, /redirect\("\/console"\)/);
  assert.doesNotMatch(home, /redirect\("\/chart"\)/);

  const mcp = read("app/console/mcp/page.tsx");
  assert.match(mcp, /user\.role !== "admin"\) redirect\("\/console\/connect"\)/);
  assert.match(mcp, /redirect\("\/console\/platform\?tab=system"\)/);
  assert.doesNotMatch(mcp, /McpBootstrapPanel|McpUrlGuide/);
});

test("workspace exposes a keyboard-operable desktop separator", () => {
  const workspace = read("components/SmartChartWorkspace.tsx");
  assert.match(workspace, /role="separator"/);
  assert.match(workspace, /aria-valuemin=\{MIN_CHAT_WIDTH\}/);
  assert.match(workspace, /onKeyDown=\{resizeChatWithKeyboard\}/);
  assert.match(workspace, /event\.key === "ArrowLeft"/);
  assert.match(workspace, /event\.key === "ArrowRight"/);
});
