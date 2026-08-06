# AiChart — AI Trading Operating System
## Master Product Specification (Investor & Engineering Edition)

| Field | Value |
|---|---|
| Document | Master Product Spec v2.0 |
| Status | Design only — no implementation in this document |
| Audience | Investors, founders, senior eng, design |
| Authority | Supersedes `AI_TRADING_OS_PRODUCT_SPEC.md` where they conflict |
| Non-negotiable | One AI Brain · Explainable decisions · No duplicated logic |

---

# Executive Verdict (read this first)

We are not shipping a prettier dashboard, an MT5 connector, or a chatbot bolted onto charts.

We are shipping an **operating system for discretionary + systematic trading**, where:

1. Conversation is the primary interface.
2. One brain owns research → decision → strategy → bot → portfolio → execution → learning.
3. Money-critical state (positions, risk, execution mode) remains **stable and visible**, even when the AI rearranges the workspace.
4. Every material claim is evidence-backed or explicitly marked unavailable.

### Hard pushbacks (CTO, not assistant)

These are places I disagree with common “AI trading OS” instincts — including some ideas in the brief:

| Idea | Verdict | Why |
|---|---|---|
| Expose “8 AI layers” as product surfaces | **Reject** | Layers are architecture. Shipping them as apps recreates multi-agent confusion and Nav bloat. |
| 7 equal Workspaces on day one | **Reject for MVP** | Over-segmentation. Ship 3 operating modes + saved layouts; expand later. |
| Full institutional Research Center (FRED+Reddit+Options+On-chain…) in v1 | **Reject** | Data licensing, quality, and ops cost explode before PMF. Start with **Evidence Federation**, not Bloomberg cosplay. |
| Marketplace in MVP | **Reject** | Marketplace without a trusted core loop becomes a junkyard of curve-fit strategies. |
| “AI dynamically builds the entire UI with no stable nav” | **Partial reject** | AI-first entry is right. Fully fluid chrome around money is dangerous. Traders must always find Positions / Risk / Kill switch in the same place. |
| Separate “Agents” product area | **Delete** | Violates One Brain. Bots are runtime instances, not brains. |
| Custom arbitrary Python/TS bots early | **Defer** | Security + determinism risk. Constrain to Strategy IR + sandboxed templates first. |
| Institution / Team as first-class v1 personas | **Defer** | Different sales, permissions, audit, and liability. Design hooks, don’t build the org product yet. |
| Showing “Probability” on every card | **Conditional** | Only with statistical backing. Otherwise label **Unavailable** — never invent. |

If we ignore these pushbacks, we will build an impressive architecture diagram and a confusing product.

---

# 1. Vision

**AiChart is the AI Trading Operating System:** a single intelligent brain that helps a trader observe markets, form explainable decisions, construct strategies, deploy bots, manage portfolio risk, execute under explicit policy, and continuously learn — across Web, MCP, Telegram, Mobile, and API — with no duplicated decision logic.

North-star outcome:

> Reduce *Time-to-Trusted-Action*: from market event → explainable decision → safe action (or conscious inaction), while keeping explainability coverage ≈ 100% for executed actions.

---

# 2. Product Philosophy

1. **One Brain.** Capabilities, not agents.
2. **AI-first, money-stable.** Conversation starts work; money controls never teleport.
3. **Evidence before conviction.** No orphan recommendations.
4. **Direction always; entry not always.** Opinion ≠ immediate execution.
5. **Systems over signals.** A signal is a moment; a system is a managed loop.
6. **Explainability is correctness.** Untraceable output is a defect.
7. **Elegance over inventory.** Prefer merge/delete to feature count.
8. **Constrained intelligence beats chatty intelligence.** Search/optimize inside validated spaces; don’t hallucinate edges.
9. **Same brain, many surfaces.** Web and MCP are projections, not forks.
10. **Trust is the product.** Speed without trust is entertainment software.

---

# 3. Competitive Analysis

## 3.1 AlgoBuilder

**Philosophy:** Idea → plain English → code → backtest → optimize → deploy to MT5 locally.  
**Loved for:** Removing coding friction; continuous chat workspace; realistic tick backtests; path to live.  
**Disliked / risks:** Becomes “code generator + local runner”; learning/monitoring loop weak once exported; optimization can encourage curve-fitting; product feels like a factory for EAs, not an OS.  
**Problem solved:** Strategy construction without a programmer.  
**Problem created:** Fragmentation — intelligence leaves the platform at deploy time.

## 3.2 TrueNorth

**Philosophy:** Agentic brokerage / “Claude Code for traders”; structured conviction; MCP as remote intelligence; playbooks; contextual memory.  
**Loved for:** Structured setups, multi-source research speed, MCP strategy, not blank-slate chat.  
**Disliked / risks:** Execution autonomy risk; crypto-native center of gravity; users may over-trust polished structured outputs; portfolio/system lifecycle still developing.  
**Problem solved:** Research → setup workflow with continuity.  
**Problem created:** Tool/playbook sprawl if not governed by one decision contract.

## 3.3 AlgoCoinism

**Philosophy:** Always-on bots, signals, radar, ready strategies, assistant glued to automation.  
**Loved for:** Continuous opportunity discovery; one-click activation; ecosystem feel.  
**Disliked / risks:** Signal culture; performance marketing of backtests; weak explainability; “bot” as toggle more than governed agent.  
**Problem solved:** Users don’t want to stare at charts 24/7.  
**Problem created:** Action bias — “something to click” even when edge is unclear.

## 3.4 TradingView

**Philosophy:** Chart as universe; social + scripting (Pine); research then commit.  
**Loved for:** Chart literacy, layouts, community density, democratized scripting.  
**Disliked / risks:** Execution/research fragmented across tools; Pine island; noise from social; not an autonomous trading brain.  
**Problem solved:** Shared visual language of markets.  
**Problem created:** Users assemble a frankenstein stack (TV + Discord + Excel + broker).

## 3.5 LuxAlgo

**Philosophy:** Proof over guessing; AI over a proprietary concept library; NL → backtested strategy; alerts as autopilot.  
**Loved for:** Constrained search (anti-hallucination), massive strategy scan, toolkit standardization.  
**Disliked / risks:** Still often lives around TradingView; alert≠managed portfolio brain; beginners may confuse scanned fitness with future expectancy.  
**Problem solved:** Strategy discovery with statistical scaffolding.  
**Problem created:** Dependency on indicator universe as moat (and user lock-in to that universe).

## 3.6 TrendSpider

**Philosophy:** Automate TA; no-code tester; scanners; multi-TF; analyst productivity.  
**Loved for:** Time saved; point-and-click + NL; scanner→strategy→alert pipeline.  
**Disliked / risks:** Power-user density; automation can create false precision; less “agentic OS,” more research workstation.  
**Problem solved:** Manual chart chores.  
**Problem created:** Tooling complexity without a single decision authority.

### Market gap we own

Competitors excel as **modules**. The winning product is a **closed learning loop** under one brain:

```text
Observe → Decide (explainable) → Systemize → Simulate → Deploy → Manage → Learn → Improve
```

…without exporting the brain to an EA file and hoping.

---

# 4. What we should copy (conceptually)

| Concept | From | Copy as |
|---|---|---|
| NL → strategy in one conversation | AlgoBuilder / LuxAlgo | Capability of One Brain, outputting Strategy IR (not orphan code) |
| Ask clarifying questions before locking rules | AlgoBuilder | Builder interview mode |
| Structured conviction, charts over hedging prose | TrueNorth | Decision Contract UI |
| MCP as remote brain | TrueNorth | Primary power-user interface parity |
| Contextual memory across workflow | TrueNorth | AI Trading Memory + Atlas |
| Always-on monitoring / radar | AlgoCoinism | Layer 1 + Layer 8 as feeds into Brain, not Buy buttons |
| Chart-centric stage + bottom workbench | TradingView | Workspace Stage (when needed) |
| Constrained strategy search / anti-hallucination | LuxAlgo | Optimizer + DNA search inside validated parameter spaces |
| Scanner → test → alert pipeline | TrendSpider | Radar → Decision → System deploy pipeline |
| Playbooks as multi-step workflows | TrueNorth | Internal skills/capabilities — **not** separate agents |

---

# 5. What we should never copy

| Anti-pattern | Why it’s toxic for us |
|---|---|
| Multi-agent storefront (“meet your 12 AI agents”) | Breaks One Brain; confuses trust boundaries |
| Export-and-forget EA workflow as the core | Kills monitoring, revision CAS, learning, unified risk |
| Signal spam / leaderboard of green win-rates | Trains gambling behavior; destroys trust |
| Unbounded chat that invents stats | Catastrophic in trading |
| Mega-nav of every feature as a page | Feels like a toolkit museum |
| Social feed as home | Noise over capital |
| Fake “institutional” source soup with weak provenance | Hallucination with citations |
| Fully custodial black-box autotrade theater | Liability + trust collapse |
| Purple AI cliché UI / card farms | Signals generic AI SaaS, not trading OS |

---

# 6. AI Architecture

## 6.1 One Brain principle (enforced)

```text
                    ┌─────────────────────────┐
   Surfaces  ──►    │   Unified Agent Runtime │
 (Web/MCP/TG/Mobile)│   (roles = modes only)  │
                    └───────────┬─────────────┘
                                │
                                ▼
                    ┌─────────────────────────┐
                    │     AI Brain (L2)        │
                    │ Evidence Bundle → Decision│
                    │ Trace → Revision          │
                    └───────────┬─────────────┘
                                │
        ┌───────────┬───────────┼───────────┬───────────┐
        ▼           ▼           ▼           ▼           ▼
   Strategy(L3) Optimizer(L4) Portfolio(L5) Research(L6) Memory
        │           │           │           │           │
        └───────────┴───────────┴─────┬─────┴───────────┘
                                      ▼
                              Execution Guards
                         (Approval / Auto policy)
```

**Forbidden:** a second decision engine inside MCP, bots, or research jobs that can open risk without Brain + guards.

## 6.2 Layers expanded (architecture, not nav)

### Layer 1 — Market Intelligence
Continuous detectors: liquidity sweeps, OB/FVG, BOS/CHoCH, breakout/compression, volume/ATR shocks, correlation breaks, sentiment shifts, news/COT/DXY/yields as available.  
**Output:** `MarketEvent` (“something important”) + severity + symbols + evidence pointers.  
**Not output:** Buy/Sell.

### Layer 2 — AI Brain
Consumes immutable Evidence Bundle → Decision Contract:
- Directional opinion
- Plan type (immediate / anticipatory / conditional)
- Execution state
- Full explainability packet (see §19)

### Layer 3 — Strategy Engine
Compiles human intent + canvas into Strategy IR; runs as living policy over Brain outputs.

### Layer 4 — Optimizer
Diagnoses decay; proposes versions; scores fragility; never silent-live-swaps without policy.

### Layer 5 — Portfolio AI
Cross-symbol/account allocation, correlation brakes, “do not run X today”.

### Layer 6 — Research AI
On-demand deep synthesis; can strengthen/weaken/revise decisions with audit — never silent rewrite after fill without management semantics.

### Layer 7 — Copilot
NL interface to all capabilities; tool-using; bound to objects (symbol/strategy/bot/decision).

### Layer 8 — Market Radar
Ranked opportunity board derived from L1+L2 priors — opens Decision objects, does not execute.

### Long-Term AI Trading Memory
Cases, lessons, preferences, strategy memory, refusal memory (“why we didn’t enter”), used as priors with sample-size honesty.

## 6.3 Roles (modes of one agent)

Analyst · Strategy Builder · Optimizer · Backtester · Portfolio Manager · Trader · Coach  

Roles may shift inside one thread; identity never forks.

---

# 7. Information Architecture

## 7.1 Ruthless IA (replaces page museums)

### Stable shell (always)

1. **Agent** — primary home (conversation + proactive brief)
2. **Live** — positions, orders, risk temperature, execution mode, kill switches
3. **Systems** — strategies + bots as one lifecycle family
4. **Knowledge** — Atlas (memory, cases, journal, lessons, playbooks)
5. **Settings** — brokers, modes, notifications, API/MCP, preferences

### Dynamic stage (opened by AI or user)

Chart · Decision Detail · Strategy Canvas · Backtest · Research Report · Radar · Analytics · Marketplace (later)

### Explicit merges

| Old concept | New home |
|---|---|
| Home/Dashboard | Agent (with brief cards) |
| Markets | Agent context + Radar panel |
| AI Recommendations / Trade Ideas / Live Trades stream | Decision objects + Live |
| Agents | Deleted |
| Journal / Analytics / Memory / Atlas | Knowledge |
| News / Calendar | Research panel + Decision evidence |
| Community | Out of v1 |
| Risk Center | Mode inside Live (+ Risk workspace layout) |

**Why this is better:** five anchors beat fifteen destinations. AI-first without losing the trade desk’s “where is my risk?” reflex.

---

# 8. Navigation

## 8.1 Desktop chrome

- Left: 5 anchors only
- Center: Agent thread **or** Stage (chart/canvas) with Agent as side/dock
- Top money rail: account · mode (`Recommend-only`/`Auto`) · open risk · daily P&L · kill
- Command Palette (`⌘K`): every capability
- Notifications inbox (decision revisions, bot health, risk breaches)

## 8.2 Default entry

User lands in **Agent**, not a KPI dashboard.

Prompts examples:
- “What’s happening in Gold?”
- “Build a London sweep bot”
- “Why did we skip the last entry?”
- “Pause everything before CPI”

AI opens the minimum panels required.

## 8.3 Anti-patterns rejected

- Sidebar with 20 product nouns
- Separate apps that require mental context rehydration
- Hiding execution mode in settings only

---

# 9. User Journeys

### J1 — Morning discretionary
Open app → Agent brief (session, radar top, overnight bot health) → ask about XAUUSD → Decision object → approve/wait → Coach explains.

### J2 — Build system from sentence
“Scalp gold London after sweep, 1% risk, ATR×1.5 SL, no high-impact news” → Builder interview → Strategy IR + Canvas → Backtest Intelligence → Paper bot → Live under gates.

### J3 — Edge decay
Bot health alert → Optimizer report → propose v3 → compare fragility → promote or rollback.

### J4 — MCP desk
In Claude: same prompts → same Brain → Decision appears in Web Live/Agent history.

### J5 — Prop-style risk day
Approaching daily loss → Portfolio/Risk capability auto-throttles → user sees breach path → optional flatten.

### J6 — Post-trade learning
Close → Journal auto-draft from Trace → Case memory update → next similar setup shows calibrated prior.

---

# 10. Personas

Design separately. **Do not show everyone everything.**

## 10.1 Beginner Trader
**Goals:** learn, avoid blowing up, understand “why”.  
**Sees:** Agent, simple Decision cards, Coach, basic Live, templates.  
**Never sees:** Canvas complexity, optimizer param grids, raw MCP tools, DNA math, team admin.  
**AI behavior:** more teaching, stricter risk defaults, fewer simultaneous systems.

## 10.2 Professional Trader
**Goals:** speed + control + explainability.  
**Sees:** Agent + Chart stage, Decision detail, Radar, Systems, Live risk.  
**Never sees:** gamified social, beginner tutorials wall.  
**AI behavior:** proactive briefs, concise traces, fast revise.

## 10.3 Prop Firm Trader
**Goals:** rule compliance, consistency, drawdown survival.  
**Sees:** Risk-first Live, daily loss meters, news locks, limited leverage posture.  
**Never sees:** high-risk grid templates by default, “max aggression” optimizers.  
**AI behavior:** rule-aware refusals; emphasize plan adherence in Journal.

## 10.4 Portfolio Manager
**Goals:** multi-account allocation, correlation, capital routing.  
**Sees:** Live exposure, Systems fleet, Portfolio AI recommendations.  
**Never sees:** single-chart toys as home.  
**AI behavior:** cross-system decisions (“pause correlated gold bots”).

## 10.5 Quant Developer
**Goals:** IR transparency, versions, backtests, reproducibility.  
**Sees:** Canvas, version diff, backtest jobs, debugger, API.  
**Never sees:** black-box “magic win rate” cards without sample size.  
**AI behavior:** precise, cites artifacts, no vibes.

## 10.6 Researcher
**Goals:** synthesize evidence, historical cases, reports.  
**Sees:** Research panel, Knowledge cases, deep jobs.  
**Never sees:** one-click live deploy as default CTA.  
**AI behavior:** Layer 6 heavy; execution suggestions require explicit switch.

## 10.7 Trading Team (v2)
**Goals:** shared systems, audit, permissions.  
**Sees:** shared Knowledge, approval queues.  
**Never sees (until v2):** full admin in personal MVP.

## 10.8 Institution (v2+)
**Goals:** controls, SSO, retention, desk workflows.  
**Status:** design compatibility only (audit logs, tenancy). Not MVP UI.

---

# 11. Workspaces

Workspaces = **layouts + default capability bias**, not separate products.

## 11.1 MVP operating modes (3)

| Mode | Purpose | Default tools |
|---|---|---|
| **Trade** | Decide & manage | Agent, Chart, Evidence, Orders, Radar |
| **Build** | Systemize | Canvas/Chat, Backtest, Versions, Simulator |
| **Operate** | Fleet & capital | Systems health, Exposure, Risk, Logs |

## 11.2 Expanded layouts (post-MVP)

Research · Quant · Portfolio · Risk · Bots · Team  

These are saved perspectives on the same objects.

## 11.3 VSCode-style Stage (when open)

- **Explorer:** symbols, systems, saved views  
- **Stage:** charts / canvas  
- **Context:** Agent / Evidence / News / Orders  
- **Workbench:** Logs / Backtests / Terminal / Journal / Debugger  

Agent can open/close these panels; Live money rail never disappears.

---

# 12. AI Agent Lifecycle

```text
Data Intake
  market, costs, calendar, account, positions, memory priors
→ Framing (L1 events + regime)
→ Evidence Assembly (freeze bundle + hash)
→ Reasoning (L2 + active role)
→ Decision Contract + Trace
→ Review (risk, cost, portfolio, freshness, revision rules)
→ Action (recommend / condition / execute / refuse with reasons)
→ Management (revisions, protective updates)
→ Outcome
→ Learning (lessons, cases, calibration)
→ Memory write (bounded, classified)
→ Continuous improvement (optimizer triggers on decay)
→ Feedback loop into future priors
```

**Proactivity rule:** on symbol focus or material L1 event, Agent speaks first with an Opening Brief — not a blank prompt box.

**Refusal is a first-class output:** “No trade” with why, alternatives, and what would change the mind.

---

# 13. MCP Architecture

## 13.1 MCP is the remote brain

Not a bag of tools. MCP exposes:

- Same identity & tenancy
- Same execution mode
- Same Evidence → Decision path
- Same object graph (decisions, strategies, bots, portfolio)
- Conversation bindings to objects

## 13.2 Primary AI interface pattern

For power users: Claude/Cursor **is** a first-class client.  
Web is the visual stage + money cockpit.  
Neither may invent a side-channel trade path.

## 13.3 Tool surface (catalog)

**Market/Research:** AnalyzeMarket, GetMarketRadar, ResearchNews, GetEconomicCalendar, FindSimilarCases, GenerateReport, GetCorrelations, GetSentimentSnapshot  

**Systems:** CreateStrategy, UpdateStrategy, ExplainStrategy, RunBacktest, CompareBacktests, OptimizeStrategy, GetStrategyDNA, SearchStrategiesByDNA, ListStrategyVersions, RollbackStrategyVersion, SetLiveStrategyState  

**Bots:** CreateBot, ConfigureBot, DeployBot, StopBot, MonitorBot, SimulateBot, PromoteBotLifecycle, RollbackBotVersion  

**Decisions/Execution:** GetActiveDecisions, ExplainDecision, OpenPosition, ClosePosition, ModifyProtectiveOrders, SetExecutionMode  

**Portfolio/Risk/Knowledge:** GetPortfolioSnapshot, GetExposure, GetRiskStatus, QueryJournalInsights, RecallTradingMemory, SaveLesson, QueryAtlas, GenerateWeeklyReview  

**Meta:** ListCapabilities, BindObjectContext  

`CreateAgent` as a separate brain: **banned**. If users say “create an agent,” product maps to **CreateBot** or **CreateSystem**.

## 13.4 MCP risks (must design against)

- Tool sprawl → capability discovery failure  
- Client-side “smart” reimplementation → logic forks  
- Over-privileged execution tools → require server-side mode + guards + idempotency  
- Context loss between clients → shared server conversation/object state  

---

# 14. Strategy Platform

One of the two crown jewels (with Bots/Systems).

## 14.1 Components

### Natural Language Builder
Compiles intent → Strategy IR. Asks only blocking questions.

### Visual Canvas
Blocks: Market → Trend → Liquidity → Pattern → News → Risk → Entry → Exit → Execution.  
Same IR as chat. No dual source of truth.

### Strategy Chat
Object-bound debugger: “why no entry?” answers from trace/costs/news/risk.

### Backtesting Intelligence
Metrics + causal language + sample-size honesty + actionable hypotheses.

### Optimizer
Constrained search; fragility; version proposal; anti-overfit warnings.

### Git-style Versions
Diffable commits; rollback; every live trade references version.

### Strategy DNA
Fingerprint across Trend/Liquidity/Momentum/Risk/Time/News/Structure for search & portfolio diversity.

### Live Strategy Brain
Runtime governor: pause on regime/news, reduce risk, resume — explained.

## 14.2 Feature justification

| Feature | Need | Why now | Why not later | Complexity | Cost | Business value | Merge? |
|---|---|---|---|---|---|---|---|
| NL Builder | Core wedge vs coding tools | Differentiator now | Delay kills positioning | Med | Med | Very high | — |
| Canvas | Trust + editability for pros | With NL to avoid chat-only fragility | Can phase visual polish | High | High | High | Keep with NL |
| Strategy Chat | Explainability for systems | Needed for bot trust | — | Med | Med | High | Merge into Agent object-bind |
| Backtest Intel | Prevent fantasy strategies | Before any Live promote | — | High | High | Critical | — |
| Optimizer | Retention + edge maintenance | After backtest exists | Full auto-optimize later | High | High | High | After Intel |
| Versions | Safety for live money | Before Live bots | — | Med | Med | Critical | — |
| DNA | Portfolio diversity + search | After library exists | MVP can wait | Med | Med | Med | V1.5 |
| Live Brain | Prevent dumb automation | With first Live bots | — | High | High | Critical | — |

---

# 15. Bot Platform

Bots are **deployed systems**, not brains.

## 15.1 Capabilities

NL create · from Strategy · templates · simulation · paper/demo/live · monitoring · optimization hooks · versioning · rollback · health · continuous learning signals · session/news filters · capital allocation

## 15.2 Lifecycle

`Draft → Simulation → Backtest → Optimization → Paper → Demo → Live → Track → Learn → Rollback`

## 15.3 Types (templates, not product silos)

Scalping, Swing, News, Grid, Mean Reversion, Trend, Breakout, Liquidity Hunter, SMC/ICT, Session (London), AI Adaptive, Visual, (later) sandboxed Custom Code.

## 15.4 Justification

| Feature | Need | Now? | Complexity | Value | Notes |
|---|---|---|---|---|---|
| NL → Bot | Hero demo | Yes | Med | Very high | Compiles to Strategy+Runtime |
| Health/Monitoring | Trust | Yes with runtime | Med | Critical | |
| Paper/Demo gates | Safety | Yes | Med | Critical | |
| Continuous learning | Moat | Partial | High | High | Feedback first; auto-mutate later |
| Custom code bots | Power users | **No (V2)** | Very high | Med | Security |
| Grid/news exotic templates | Nice | Selective | Med | Med | Only if risk framed |

---

# 16. Research Center

## 16.1 CTO framing

Do **not** build 15 miniature websites. Build an **Evidence Federation** with provenance, freshness, and Brain ingestion.

## 16.2 Source classes (phased)

**MVP:** broker/market data, economic calendar, curated news/RSS, internal structure engines, historical cases, costs.  
**V1.5:** COT, FRED/macro series, correlation matrices, sentiment scorers.  
**V2:** broader social firehose, options, on-chain, whale alerts — only with quality SLAs.

## 16.3 Integration into One Brain

Sources → normalized evidence items → optional Deep Research job → bundle enrichment → Brain revision with audit.

Research never bypasses Decision Contract.

## 16.4 Justification

Full “institutional terminal” now = high cost, slow PMF. Federation MVP = 80% of user value.

---

# 17. Portfolio

Accounts · brokers · positions · orders · PnL · exposure · correlation · allocations across systems · calendar PnL · (tax later)

Portfolio AI suggestions are advisory unless user grants Operate permissions.

Merge Live Trades into Portfolio/Live — no separate app.

---

# 18. Risk Center

Not a vanity dashboard. It is **policy authority**:

- Daily loss / max positions / correlation caps  
- News and session locks  
- Kill switches (global / system / symbol)  
- Breach timeline  
- Pre-trade what-if  

UX: always in money rail + deep Operate/Risk layout.

---

# 19. Recommendations (= Decisions)

Rename mentally from “recommendations page” to **Decision Objects**.

### Mandatory explainability packet

Every decision must carry:

Evidence · Confidence · Probability* · Alternatives · Risk · Decision Trace · Execution Quality · Historical Similarity · Cost Analysis · Why this · Why not another · Why now · Why not later  

\*Probability only if statistically supported; else `unavailable`.

### UI

Primarily in Agent timeline + Decision Detail stage + Live inbox filters.  
Not a fourth competing home.

---

# 20. Analytics

Rollups for performance, system quality, execution quality, costs, calibration of AI confidence, heatmaps.

**Rule:** Analytics inform Optimizer/Coach; they do not silently mutate live risk.

Merge into Knowledge/Operate views; executive Analytics page optional later.

---

# 21. Journal

Auto-drafted from traces/outcomes:

why entered · why exited · plan adherence · mistakes · lessons  

User annotates; system structures. Lives under Knowledge.

---

# 22. Atlas

Knowledge OS: playbooks, lessons, tutor mode, case library, annotated memory.

Case card standard:

> Seen 184×. Win 71%. High-impact news → 48%. London → 78%. Spread > 2.5 → edge negative.

---

# 23. Marketplace

**V2.** After trusted Systems + verified track records.

Listings: strategies, bots, templates, prompts, (later) indicators.  
Rank by transparent stats + sample size + audit freshness — not hype.

---

# 24. Mobile Experience

Mobile = **decision & control surface**, not IDE.

Tabs: Agent · Live · Systems (status/pause) · Knowledge lite · Settings  

Push-first: decision revisions, risk breaches, bot health.  
No Canvas/Optimizer on mobile MVP. Deep link to desktop for build work.

---

# 25. Desktop Experience

Desktop = full OS: Agent-first shell, Stage IDE, Build tools, Operate fleet, MCP companion.

Density modes: Focus · Standard · Desk.  
Identity: calm terminal precision (Bloomberg density × Linear clarity × Cursor agent presence) — not generic AI purple, not social TV noise.

---

# 26. Backend Modules

Gateway/API · Unified Agent Runtime · Evidence Service · Decision Engine · Market Intelligence · Strategy Service · Research Service · Optimization Workers · Bot Orchestrator · Execution Service + Guards · Portfolio/Risk · Memory/Atlas · Notifications · MCP Adapter · Analytics Pipeline · Entitlements (later marketplace)

---

# 27. Frontend Modules

`AgentShell` · `MoneyRail` · `Stage` (Chart/Canvas) · `DecisionDetail` · `Systems` · `Knowledge` · `ResearchPanel` · `RadarPanel` · `CommandPalette` · `Notifications` · `Settings` · design system / charts / evidence widgets

---

# 28. Database Modules

Identity/Tenancy · Brokers/Accounts · Market cache · L1 Events · Evidence Bundles · Decisions/Revisions/Traces/Outcomes · Strategies/Versions/DNA · Backtests/Optimizations · Bots/Health/Versions · Execution/Intents/Fills · Portfolio snapshots · Risk policies/breaches · Research jobs · Journal · Memory/Cases/Lessons · Analytics rollups · Audit/Telemetry · Marketplace (later)

---

# 29. AI Memory

Types: trading · strategy · user behavior · style · mistakes · wins · playbooks · favorite markets · historical cases · refusal memory · lessons  

Write policy: bounded, classified, no secrets, no treating memory prices as live truth.  
Recall: ranked, cited, sample-size visible.

---

# 30. Long-term Roadmap

**Year narrative (capability, not calendar theater):**

1. **Trust loop:** explainable decisions + safe execution parity across surfaces  
2. **System loop:** build → test → paper → live bots with governors  
3. **Intelligence loop:** radar + memory cases + optimizer  
4. **Distribution loop:** MCP-first power users + mobile control  
5. **Network loop:** marketplace + team  
6. **Expansion loop:** broader asset classes / institutional controls  

---

# 31. MVP Scope (ruthless)

### In
- One Brain across Web + MCP (behavioral parity)
- Agent-first shell + Money rail + 5 anchors
- Decision objects with full explainability packet
- Proactive symbol briefs
- Strategy NL builder + basic Canvas + versions
- Backtest Intelligence (honest)
- Bots to Paper/Demo + health + promote gates
- Live execution modes (Recommend-only / Auto) with guards
- Knowledge: journal auto + basic cases/memory recall
- Risk basics in Live
- Mobile: Agent + Live + pause systems

### Out of MVP
- Marketplace
- Community
- Team/Institution admin
- Custom code bots
- Full macro/social/on-chain federation
- DNA search sophistication
- Tax suite
- 7 branded workspaces as products

---

# 32. V2 Scope

- Marketplace with proof ranking  
- Team workspace + approvals  
- Advanced Research federation  
- DNA portfolio balancing  
- Sandboxed custom bots  
- Deeper mobile analytics  
- Institutional tenancy features  
- Richer Optimizer (walk-forward automation)

---

# 33. Features to Remove

- Multi-agent catalog / Agents page  
- Standalone AI Analyst destination  
- Standalone Trade Ideas feed competing with Decisions  
- Community home in v1  
- Dashboard-of-KPIs as default landing  
- Any second execution brain in MCP  
- WAIT-as-cop-out philosophy (replace with conditional plans + refusals with reasons)  
- Marketing win-rate widgets without sample size / costs  

---

# 34. Features to Merge

| Merge | Into |
|---|---|
| Recommendations + Trade Ideas + signal inbox | Decisions |
| Strategies + Bots product silos | Systems (definition vs runtime) |
| Journal + Memory + Lessons + Tutor | Knowledge / Atlas |
| News + Calendar + Research sites | Research panel / Evidence Federation |
| Analytics + Performance pages | Operate + Knowledge views |
| Risk Center page-only | Live money rail + Risk layout |
| Multiple chatbots | One Agent with roles |

---

# 35. Final CTO Review (self-critique)

### Duplicate concepts found & fixed
- Agents vs Bots vs Brain → Agents deleted; Bots = runtime  
- Radar vs Markets vs Ideas → Radar panel + Decision objects  
- Atlas vs Memory vs Journal → Knowledge  
- Prior 10-item nav → 5 anchors + dynamic stage  

### UX risks remaining
- AI-first can still intimidate beginners → persona-gated simplicity required  
- Explainability packet can become wall-of-text → progressive disclosure mandatory  

### Scalability / maintainability
- One Brain is right but becomes a monolith risk → modular services **behind** one decision contract  
- Tool catalog growth must stay capability-grouped with ListCapabilities  

### Security
- Execution tools server-authorized only  
- No secret leakage into memory/traces  
- Custom code deferred for tenancy isolation reasons  

### AI hallucination risks
- Hard ban on unsupported probabilities  
- Constrained optimizer spaces  
- Evidence hash binding  
- “Unavailable” labeling as a feature, not a failure  

### MCP risks
- Parity tests between Web and MCP decisions  
- Shared mode state  
- Idempotent execution  

### Performance bottlenecks
- L1 detectors cost → prioritize symbol universe + event severity gating  
- Deep research async only  
- Backtests as workers, never request-thread blocking  

### Over-engineering risks
- 8 layers as microservices too early → start with modular monolith boundaries  
- 7 workspaces as eng projects → layouts first  

### Under-engineering risks
- Shipping NL strategies without versions/paper gates → capital harm  
- Marketplace before calibration → trust harm  

### Redesign applied after critique
- Reduced IA  
- Systems merge  
- Research phased  
- Marketplace deferred  
- Probability honesty rule  
- Money rail stability exception to pure AI-fluid UI  

---

# 36. Final Product Score (0–100)

| Dimension | Score | Note |
|---|---|---|
| Vision clarity | 92 | Sharp OS positioning |
| Differentiation | 88 | Closed loop under one brain |
| IA simplicity | 84 | After ruthless merge |
| Explainability design | 90 | Contract is strong |
| MVP realism | 78 | Still ambitious; needs discipline |
| Technical coherence | 86 | Matches existing brain foundations |
| Go-to-market focus | 80 | Persona gating helps |
| Risk of scope creep | 70 | Main failure mode |
| **Weighted overall** | **84 / 100** | Strong if MVP knife stays sharp |

Deductions mostly from execution risk (scope, data federation temptation, optimizer overfit culture), not from concept quality.

---

# 37. Biggest Risks

1. **Scope creep into Bloomberg+TV+EA-builder simultaneously**  
2. **Hallucinated statistics destroying trust in week one**  
3. **Logic fork between Web and MCP**  
4. **Auto-execution reputation risk from one bad bot day**  
5. **Optimizer-driven overfitting sold as intelligence**  
6. **Beginner blow-ups if defaults are too aggressive**  
7. **Data vendor cost/quality for Research ambitions**  
8. **Regulatory/liability ambiguity around “AI trader” language**  

---

# 38. Biggest Opportunities

1. **Category creation:** AI Trading OS (not another signal shop)  
2. **MCP-native distribution** into existing AI work habits  
3. **Explainability as moat** (traders don’t trust black boxes)  
4. **System lifecycle** (build→paper→live→learn) competitors split across tools  
5. **Memory cases** that compound with usage (switching cost)  
6. **Prop-trader compliance angle** (rules-aware brain)  
7. **Unified FX/Gold desk** with real cost modeling already in DNA of the company  

---

# 39. Recommended Implementation Order

1. **Brain parity & Decision Contract UX** (Web ↔ MCP)  
2. **Agent-first shell + Money rail + 5 anchors**  
3. **Proactive briefs + Decision Detail explainability packet**  
4. **Systems v1: NL Strategy → IR → Versions → Backtest Intelligence**  
5. **Bots to Paper/Demo + Health + Promote gates**  
6. **Live Auto path hardened (guards, revision CAS, kill switches)**  
7. **Knowledge v1 (journal auto, recall, case card)**  
8. **Radar panel (L1→L8) without Buy CTA**  
9. **Optimizer v1 + Live Strategy Brain governors**  
10. **Mobile control surface**  
11. **Research federation expansion**  
12. **DNA + Portfolio AI**  
13. **Marketplace**  
14. **Team / Institution**  

---

# Appendix A — Decision Contract (product schema, conceptual)

```text
Decision {
  symbol, timeframe_context,
  direction,                    // always present if analysis succeeded
  plan_type,                    // immediate | anticipatory | conditional
  execution_state,              // actionable_now | waiting_condition | expired | invalidated | blocked
  entry, stop, targets[],
  confidence,
  probability?,                 // optional, else unavailable
  alternatives[],
  risk,
  cost_analysis,
  execution_quality,
  evidence_bundle_hash,
  decision_trace_id,
  similar_cases[],
  why_this, why_not_other, why_now, why_not_later,
  revision_no,
  bound_system_id?
}
```

---

# Appendix B — One-line pitch

**AiChart is the operating system where one trading brain turns conversation into explainable decisions, living systems, and governed execution — continuously learning, never forking.**

---

# Appendix C — Relationship to prior spec

`AI_TRADING_OS_PRODUCT_SPEC.md` remains useful detail inventory.  
**This Master Spec wins on:** IA ruthlessness, persona gating, MVP knife, feature justification, and CTO pushbacks.

---

*End of Master Product Specification v2.0 — Design only.*
