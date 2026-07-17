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

test("workspace has no second chat-history sidebar; compact Chart/Chat switcher only", () => {
  const workspace = read("components/SmartChartWorkspace.tsx");
  const sidebarMounts = workspace.match(/<AgentChatSidebar/g) ?? [];
  assert.equal(sidebarMounts.length, 0, "chat history lives in the canonical shell sidebar");
  assert.doesNotMatch(workspace, /hidden w-\[240px\] shrink-0 xl:block/);
  assert.doesNotMatch(workspace, /chatSidebarOpen/);
  assert.match(workspace, /data-testid="chart-chat-switcher"/);
  assert.match(workspace, /h-11 shrink-0/);
  assert.doesNotMatch(workspace, /bg-primary text-primary-foreground shadow-sm/);
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

test("canonical shell exposes ThemeToggle and one opaque sidebar architecture", () => {
  const shell = read("components/shell/AppConsoleShell.tsx");
  assert.match(shell, /ThemeToggle/);
  assert.match(shell, /data-testid="theme-toggle"|<ThemeToggle/);
  assert.match(shell, /data-testid="canonical-desktop-sidebar"/);
  assert.match(shell, /data-testid="canonical-mobile-drawer"/);
  assert.match(shell, /data-testid="canonical-chats-section"/);
  assert.match(shell, /data-testid="mobile-menu-trigger"/);
  assert.match(shell, /bg-sidebar/);
  assert.doesNotMatch(shell, /glass-panel/);
  assert.equal((shell.match(/data-testid="canonical-desktop-sidebar"/g) ?? []).length, 1);
  assert.equal((shell.match(/data-testid="mobile-menu-trigger"/g) ?? []).length, 1);
  assert.match(read("components/ThemeToggle.tsx"), /data-testid="theme-toggle"/);
  assert.match(read("components/ThemeToggle.tsx"), /setTheme/);
});

test("corrective tokens remove purple glow and keep restrained accent", () => {
  const css = read("app/globals.css");
  assert.match(css, /--glow-brand:\s*none/);
  assert.match(css, /\.glass-panel\s*\{[\s\S]*backdrop-filter:\s*none/);
  assert.match(css, /\.dark \.glass-card\s*\{[\s\S]*box-shadow:\s*none/);
  assert.doesNotMatch(css, /#bc00ff/);
  const chat = read("components/agent/SmartChartAgentPanel.tsx");
  assert.doesNotMatch(chat, /bg-primary\/10/);
  assert.doesNotMatch(chat, /glass-card mr-auto/);
  assert.match(chat, /--user-bubble/);
});

test("brand assets use transparent face-mark paths", () => {
  const logo = read("components/AiChartLogo.tsx");
  assert.match(logo, /\/brand\/aichart-mark/);
  assert.match(logo, /object-contain/);
  assert.doesNotMatch(logo, /lonora-logo/);
  const avatar = read("components/AgentAvatar.tsx");
  assert.match(avatar, /AnimatedAgentAvatar/);
  const animated = read("components/AnimatedAgentAvatar.tsx");
  assert.match(animated, /data-state=\{state\}/);
  assert.match(animated, /agent-eye-left/);
});

test("favicon and PWA metadata point at current AiChart mark", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /site\.webmanifest/);
  assert.match(layout, /favicon-32x32\.png/);
  assert.match(layout, /apple-touch-icon\.png/);
  assert.doesNotMatch(layout, /lonora-logo/);
  assert.ok(existsSync(resolve(process.cwd(), "public", "favicon-32x32.png")));
  assert.ok(existsSync(resolve(process.cwd(), "public", "site.webmanifest")));
  assert.ok(existsSync(resolve(process.cwd(), "src", "app", "icon.png")));
  assert.ok(existsSync(resolve(process.cwd(), "src", "app", "apple-icon.png")));
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
