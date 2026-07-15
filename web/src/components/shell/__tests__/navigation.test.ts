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
    "/chart",
    "/console",
    "/console/trades",
    "/console/recommendations",
    "/recommendations",
    "/statistics",
    "/console/connect",
    "/console/settings",
    "/console/risk",
    "/console/mcp",
  ]) {
    assert.ok(hrefs.includes(required), `APP_NAV missing ${required}`);
  }
});

test("admin items are hidden from regular users and visible to admins", () => {
  const user = navForRole("user").map((i) => i.href);
  const admin = navForRole("admin").map((i) => i.href);
  assert.ok(!user.some((href) => href.includes("/console/platform")));
  assert.ok(admin.some((href) => href.includes("/console/platform?tab=users")));
  assert.ok(admin.length > user.length);
});

test("activeNav highlights exact, prefix, and tabbed routes correctly", () => {
  const chart = APP_NAV.find((i) => i.href === "/chart")!;
  const overview = APP_NAV.find((i) => i.href === "/console")!;
  const trades = APP_NAV.find((i) => i.href === "/console/trades")!;
  const users = APP_NAV.find((i) => i.href === "/console/platform?tab=users")!;

  assert.equal(activeNav("/chart/abc123", chart), true);
  assert.equal(activeNav("/console", overview), true);
  assert.equal(activeNav("/console/trades", overview), false, "exact item must not match children");
  assert.equal(activeNav("/console/trades", trades), true);
  assert.equal(activeNav("/console/platform", users, "users"), true);
  assert.equal(activeNav("/console/platform", users, "keys"), false);
});

test("tracked recommendations and console recommendation history never both highlight", () => {
  const tracked = APP_NAV.find((i) => i.href === "/recommendations")!;
  const history = APP_NAV.find((i) => i.href === "/console/recommendations")!;
  assert.equal(activeNav("/recommendations", tracked), true);
  assert.equal(activeNav("/recommendations", history), false);
  assert.equal(activeNav("/console/recommendations", history), true);
  assert.equal(activeNav("/console/recommendations", tracked), false);
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

test("the chart workspace renders ONE chat sidebar for desktop and mobile (drawer)", () => {
  const workspace = read("components/SmartChartWorkspace.tsx");
  const sidebarMounts = workspace.match(/<AgentChatSidebar/g) ?? [];
  assert.equal(sidebarMounts.length, 2, "desktop column + mobile drawer, same component");
  // Desktop column hidden below md; mobile drawer exists and closes on select.
  assert.match(workspace, /hidden w-\[240px\] shrink-0 md:block/);
  assert.match(workspace, /chatSidebarOpen/);
  assert.match(workspace, /md:hidden/);
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
  assert.match(menu, /router\.push\("\/console"\)/);
  assert.match(menu, /router\.push\("\/console\/settings"\)/);
});
