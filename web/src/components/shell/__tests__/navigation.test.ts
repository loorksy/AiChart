import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { activeNav, APP_NAV, navForRole } from "@/components/shell/navConfig";

const root = resolve(process.cwd(), "src");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

test("APP_NAV is the single primary source with four destinations in order", () => {
  const userHrefs = navForRole("user").map((i) => i.href);
  assert.deepEqual(userHrefs, [
    "/console",
    "/console/chats",
    "/statistics",
    "/console/trades",
  ]);
  assert.deepEqual(
    navForRole("user").map((i) => i.labelKey),
    ["nav.workspace", "nav.chat_history", "nav.statistics", "nav.trades"],
  );
});

test("Account, Integrations, and Settings are not primary sidebar destinations", () => {
  const hrefs = new Set(APP_NAV.map((i) => i.href));
  for (const hidden of [
    "/console/account",
    "/console/connect",
    "/console/settings",
    "/console/recommendations",
  ]) {
    assert.equal(hrefs.has(hidden), false, hidden);
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
  const chats = APP_NAV.find((i) => i.href === "/console/chats")!;

  assert.equal(activeNav("/console", overview), true);
  assert.equal(activeNav("/console/trades", overview), false, "exact item must not match children");
  assert.equal(activeNav("/console/trades", trades), true);
  assert.equal(activeNav("/console/chats", chats), true);
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
  assert.doesNotMatch(read("components/admin/adminNav.ts"), /ADMIN_NAV\s*=/);
});

test("workspace has no second chat-history sidebar; compact Chart/Chat switcher only", () => {
  const workspace = read("components/SmartChartWorkspace.tsx");
  const sidebarMounts = workspace.match(/<AgentChatSidebar/g) ?? [];
  assert.equal(sidebarMounts.length, 0, "chat history is a dedicated destination");
  assert.doesNotMatch(workspace, /hidden w-\[240px\] shrink-0 xl:block/);
  assert.doesNotMatch(workspace, /chatSidebarOpen/);
  assert.match(workspace, /data-testid="chart-chat-switcher"/);
  assert.match(workspace, /h-10 shrink-0/);
  assert.match(workspace, /justify-center/);
  assert.doesNotMatch(workspace, /bg-primary text-primary-foreground shadow-sm/);
  assert.doesNotMatch(workspace, /UserShell|BridgeShell|ChatGptSidebar/);
});

test("shell-less agent pages now use the unified AppConsoleShell", () => {
  assert.match(read("app/recommendations/layout.tsx"), /AppConsoleShell/);
  assert.match(read("app/statistics/layout.tsx"), /AppConsoleShell/);
});

test("profile menu contains Profile, Language, Theme, Settings, Logout with icon language/theme", () => {
  const menu = read("components/agent/SidebarProfileMenu.tsx");
  assert.match(menu, /router\.push\("\/console\/account"\)/);
  assert.match(menu, /router\.push\("\/console\/settings"\)/);
  assert.match(menu, /data-testid="profile-language"/);
  assert.match(menu, /data-testid="theme-toggle"/);
  assert.match(menu, /<Globe/);
  assert.match(menu, /<Sun|<Moon|Sun className|Moon className/);
  assert.match(menu, /profile\.logout|t\("profile\.logout"\)/);
  assert.doesNotMatch(menu, /Switch to light mode/);
  assert.doesNotMatch(menu, /router\.push\("\/dashboard"\)/);
});

test("canonical shell exposes one opaque sidebar and profile menu — no chats column", () => {
  const shell = read("components/shell/AppConsoleShell.tsx");
  assert.match(shell, /SidebarProfileMenu/);
  assert.match(shell, /data-testid="canonical-desktop-sidebar"/);
  assert.match(shell, /data-testid="canonical-mobile-drawer"/);
  assert.match(shell, /data-testid="mobile-menu-trigger"/);
  assert.match(shell, /data-testid="canonical-product-nav"/);
  assert.match(shell, /bg-sidebar/);
  assert.doesNotMatch(shell, /glass-panel/);
  assert.doesNotMatch(shell, /canonical-chats-section/);
  assert.equal((shell.match(/data-testid="canonical-desktop-sidebar"/g) ?? []).length, 1);
  assert.equal((shell.match(/data-testid="mobile-menu-trigger"/g) ?? []).length, 1);
  assert.equal((shell.match(/data-testid="canonical-mobile-drawer"/g) ?? []).length, 1);
});

test("chat history page exists as a dedicated destination", () => {
  assert.ok(existsSync(resolve(root, "app/console/chats/page.tsx")));
  const page = read("app/console/chats/page.tsx");
  assert.match(page, /chats\.title/);
  assert.match(page, /nav\.new_chat/);
});

test("settings stay on one canonical destination with internal tabs only", () => {
  const settings = read("components/SettingsClient.tsx");
  assert.match(settings, /settings\.tab\.account/);
  assert.match(settings, /settings\.tab\.appearance/);
  assert.match(settings, /settings\.tab\.connections/);
  assert.doesNotMatch(settings, /APP_NAV/);
  assert.doesNotMatch(settings, /canonical-product-nav/);
  assert.ok(existsSync(resolve(root, "app/console/settings/page.tsx")));
});

test("corrective tokens remove purple from normal UI", () => {
  const css = read("app/globals.css");
  assert.match(css, /--glow-brand:\s*none/);
  assert.match(css, /\.glass-panel\s*\{[\s\S]*backdrop-filter:\s*none/);
  assert.doesNotMatch(css, /#bc00ff/);
  assert.doesNotMatch(css, /#7c3aed/);
  assert.doesNotMatch(css, /#8b5cf6/);
  assert.match(css, /--primary:\s*#18181b/);
  assert.match(css, /\.aichart-scroll/);
  assert.match(css, /::-webkit-scrollbar-button/);
  assert.match(css, /\.chat-composer-shell/);
  const chat = read("components/agent/SmartChartAgentPanel.tsx");
  assert.doesNotMatch(chat, /bg-primary\/10/);
  assert.match(chat, /--user-bubble/);
  assert.match(chat, /chat-scroll-region/);
  const composer = read("components/agent/AgentChatInput.tsx");
  assert.match(composer, /chat-composer-shell/);
  assert.doesNotMatch(composer, /border-t border-border bg-background/);
});

test("statistics dashboard uses a responsive summary grid", () => {
  const overview = read("components/recommendations/RecommendationStatsOverview.tsx");
  assert.match(overview, /stats-summary-grid/);
  assert.match(overview, /xl:grid-cols-4/);
  assert.match(overview, /sm:grid-cols-2/);
  const page = read("app/statistics/page.tsx");
  assert.match(page, /max-w-7xl/);
  assert.doesNotMatch(page, /bg-primary text-primary-foreground/);
});

test("brand mark SVG viewBox contains the full face (eyes + diamond)", () => {
  const mark = readFileSync(resolve(process.cwd(), "public/brand/aichart-mark.svg"), "utf8");
  const light = readFileSync(resolve(process.cwd(), "public/brand/aichart-mark-light.svg"), "utf8");
  for (const svg of [mark, light]) {
    assert.match(svg, /viewBox="100 250 900 670"/);
    assert.match(svg, /M258\.63 274\.35/);
    assert.match(svg, /M805\.76 274\.41/);
    assert.match(svg, /M542\.79 642\.35/);
  }
  const logo = read("components/AiChartLogo.tsx");
  assert.match(logo, /object-contain/);
  assert.match(logo, /overflow-visible/);
  assert.doesNotMatch(logo, /object-cover/);
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

test("AI chat meta composer exists and messages route schedules refresh", () => {
  assert.ok(existsSync(resolve(root, "lib/agent/chatHistory/composeChatMeta.ts")));
  assert.ok(existsSync(resolve(root, "lib/agent/chatHistory/refreshChatMeta.ts")));
  const route = read("app/api/agent/chats/[chatId]/messages/route.ts");
  assert.match(route, /refreshChatMetaAfterAssistantTurn/);
  const store = read("lib/agent/chatHistory/chatStore.ts");
  assert.match(store, /updateChatMeta/);
  assert.doesNotMatch(store, /shouldTitle \? deriveChatTitle/);
});
