# Graph Report - web\src  (2026-06-10)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 968 nodes · 3203 edges · 33 communities (31 shown, 2 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 47 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e1ea7283`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 32|Community 32]]

## God Nodes (most connected - your core abstractions)
1. `cn()` - 88 edges
2. `handleError()` - 81 edges
3. `requireUser()` - 55 edges
4. `getSettings()` - 53 edges
5. `execute()` - 42 edges
6. `getLimits()` - 36 edges
7. `getCurrentUser()` - 33 edges
8. `handleMessage()` - 25 edges
9. `executeTool()` - 25 edges
10. `requireAdmin()` - 25 edges

## Surprising Connections (you probably didn't know these)
- `GET()` --calls--> `handleError()`  [INFERRED]
  app/api/admin/kill-switch/route.ts → lib/api.ts
- `POST()` --calls--> `handleError()`  [INFERRED]
  app/api/admin/kill-switch/route.ts → lib/api.ts
- `PATCH()` --calls--> `handleError()`  [INFERRED]
  app/api/admin/users/[id]/route.ts → lib/api.ts
- `PATCH()` --calls--> `requireAdmin()`  [INFERRED]
  app/api/admin/users/[id]/route.ts → lib/api.ts
- `DELETE()` --calls--> `handleError()`  [INFERRED]
  app/api/admin/users/[id]/route.ts → lib/api.ts

## Import Cycles
- 3-file cycle: `lib/db.ts -> lib/db/index.ts -> lib/env.ts -> lib/db.ts`
- 4-file cycle: `lib/db.ts -> lib/db/index.ts -> lib/db/sqlite.ts -> lib/env.ts -> lib/db.ts`

## Communities (33 total, 2 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (78): TelegramLoginButton(), Window, GET(), patchSchema, POST(), PUT(), dispatchAlert(), DispatchAlertOptions (+70 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (71): GET(), DELETE(), PATCH(), ChatPage(), imageSchema, POST(), schema, createSchema (+63 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (54): bootstrapCache, ensureDb(), execute(), getBootstrapFromCache(), getDbBackend(), getDbInfo(), initDb(), isPostgresReady() (+46 more)

### Community 3 - "Community 3"
Cohesion: 0.10
Nodes (59): consumeLinkCode(), getRecommendation(), getUserByTelegramChatId(), getUserByTelegramId(), setTelegramChatId(), setUserTelegramId(), updateIntentNotional(), updateIntentStatus() (+51 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (50): schema, POST(), POST(), RunAgentOptions, ActivityListener, ApiError, requireActiveUser(), AccountSummary (+42 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (34): ChatClient(), MessageBubble(), RecCard(), ChatSquareClient(), STATUS_AR, STATUS_CLASS, TradesClient(), useAgentActivities() (+26 more)

### Community 6 - "Community 6"
Cohesion: 0.13
Nodes (26): Instrument, MarketClient(), OVERLAY_LABELS, PriceChart(), Props, SignalsWizardClient(), LivePriceMap, LivePriceTick (+18 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (29): arcPath(), AssetDistributionChart(), polarToCartesian(), SLICE_COLORS, InteractivePerformanceChart(), PeriodSelector(), ReportsClient(), DashboardAnalytics() (+21 more)

### Community 8 - "Community 8"
Cohesion: 0.10
Nodes (25): AppShell(), DashboardClient(), STATUS_LABEL, ALERT_TYPE_LABEL, AlertsCard(), SettingsClient(), TabId, TABS (+17 more)

### Community 9 - "Community 9"
Cohesion: 0.14
Nodes (22): TradingCard(), GET(), allowedAssetsLabel(), isOpenAssetsPolicy(), parseAllowedAssets(), resolveAllowedAssets(), resolveMonitorAssets(), DENY (+14 more)

### Community 10 - "Community 10"
Cohesion: 0.18
Nodes (20): POST(), schema, POST(), rawSchema, schema, SL_LABEL, STYLE_LABEL, countPendingIntents() (+12 more)

### Community 11 - "Community 11"
Cohesion: 0.13
Nodes (25): AnalysisProfile, AnalysisTier, buildProfilePromptHints(), INTRADAY, POSITION, profileForInterval(), SWING, ChartPoint (+17 more)

### Community 12 - "Community 12"
Cohesion: 0.23
Nodes (12): AdminOverviewPage(), POST(), schema, GET(), GET(), requireAdmin(), getAdminPlatformStats(), getFlag() (+4 more)

### Community 13 - "Community 13"
Cohesion: 0.12
Nodes (15): BEGINNER_STEPS, EXPERT_STEPS, CAPITAL_OPTIONS, Instrument, STEP_LABELS, STATUS_LABEL, AppHeader(), ALERT_TYPE_LABEL (+7 more)

### Community 14 - "Community 14"
Cohesion: 0.12
Nodes (30): DELETE(), GET(), PATCH(), patchSchema, GET(), POST(), schema, DELETE() (+22 more)

### Community 15 - "Community 15"
Cohesion: 0.17
Nodes (16): AdminUsagePanel(), DELETE(), PATCH(), schema, ADMIN_LIMIT_FIELDS, AdminUserView, ClaudeUsageRow, deleteUser() (+8 more)

### Community 16 - "Community 16"
Cohesion: 0.29
Nodes (6): AdminUsersTable(), TableMode, listUsersForAdmin(), AdminLimitsPage(), AdminUsersPage(), GET()

### Community 17 - "Community 17"
Cohesion: 0.15
Nodes (20): applyChartDrawings(), ApplyDrawingsResult, collectDrawingMarkers(), FIB_RATIOS, fibLevels(), markerShape(), numMeta(), pointArrMeta() (+12 more)

### Community 18 - "Community 18"
Cohesion: 0.15
Nodes (22): AdminLayout(), metadata, Home(), DashboardPage(), GET(), clearSession(), createSessionToken(), getCurrentUser() (+14 more)

### Community 19 - "Community 19"
Cohesion: 0.20
Nodes (16): executeTool(), TOOLS, CliResult, isBinanceCliEnabled(), READ_GROUPS, runBinanceCli(), smartMoneySignals(), formatContextForPrompt() (+8 more)

### Community 20 - "Community 20"
Cohesion: 0.15
Nodes (15): AgentPlanMode, ANALYSIS_PLAN_TEMPLATE, applyProgress(), cloneTasks(), flattenSubtaskKeys(), getPlanTemplate(), PlanStatus, PlanSubtask (+7 more)

### Community 21 - "Community 21"
Cohesion: 0.20
Nodes (16): ALLOWED, GET(), get24hStats(), getKlines(), ema(), macd(), MacdResult, rsi() (+8 more)

### Community 22 - "Community 22"
Cohesion: 0.17
Nodes (15): CallFn, CHAINS, CommandMap, cryptoMarketRank(), marketRank, MarketRankCommand, SkillReq, tradingSignal (+7 more)

### Community 23 - "Community 23"
Cohesion: 0.14
Nodes (12): cairo, fraunces, inter, jetbrainsMono, metadata, getSystemTheme(), ResolvedTheme, resolveTheme() (+4 more)

### Community 24 - "Community 24"
Cohesion: 0.19
Nodes (11): ChatMessageRow, Conversation, ChatGptSidebar(), isTabActive(), MAIN_TABS, isTabActive(), MAIN_TABS, MobileDrawer() (+3 more)

### Community 25 - "Community 25"
Cohesion: 0.21
Nodes (7): Textarea, TextareaProps, AiChatAction, DEFAULT_ACTIONS, useAutoResizeTextarea(), VercelV0Chat(), VercelV0ChatProps

### Community 26 - "Community 26"
Cohesion: 0.22
Nodes (6): AdminKeysPanel(), ConfigField, GROUPS, StatusBadge(), ClaudeModelOption, ClaudeModelPicker()

### Community 27 - "Community 27"
Cohesion: 0.31
Nodes (4): ADMIN_ACTION_LABELS, ADMIN_NAV, AuditRow, listAuditLogs()

### Community 28 - "Community 28"
Cohesion: 0.40
Nodes (3): AdminSystemPanel(), HealthPayload, StatusPill()

### Community 32 - "Community 32"
Cohesion: 0.33
Nodes (3): AdminOverview(), MasterKillCard(), AdminPlatformStats

## Knowledge Gaps
- **152 isolated node(s):** `metadata`, `bodySchema`, `patchSchema`, `schema`, `schema` (+147 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `Community 6` to `Community 32`, `Community 5`, `Community 7`, `Community 8`, `Community 13`, `Community 15`, `Community 16`, `Community 20`, `Community 24`, `Community 25`, `Community 26`, `Community 27`, `Community 28`?**
  _High betweenness centrality (0.109) - this node is a cross-community bridge._
- **Why does `handleError()` connect `Community 14` to `Community 0`, `Community 1`, `Community 2`, `Community 4`, `Community 10`, `Community 12`, `Community 15`, `Community 16`, `Community 18`, `Community 21`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Why does `getSettings()` connect `Community 10` to `Community 0`, `Community 1`, `Community 3`, `Community 4`, `Community 9`, `Community 14`, `Community 15`, `Community 16`, `Community 18`, `Community 19`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Are the 10 inferred relationships involving `handleError()` (e.g. with `POST()` and `DELETE()`) actually correct?**
  _`handleError()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `requireUser()` (e.g. with `GET()` and `DELETE()`) actually correct?**
  _`requireUser()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `metadata`, `bodySchema`, `patchSchema` to the rest of the system?**
  _152 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.050042955326460484 - nodes in this community are weakly interconnected._