/**
 * Coverage map for every §16 reference scenario.
 *
 * A row in REFERENCE_SCENARIOS is not proof it is tested. This map is the
 * machine-checked link from scenario id → owning test(s). The companion
 * `referenceScenarioCoverage.test.ts` fails when a scenario lacks an owner,
 * an owner points at a missing scenario, expected/forbidden results are empty,
 * or a critical scenario lacks an integration-class owner.
 */
import { REFERENCE_SCENARIOS } from "./referenceScenarioPack";

export type CoverageKind =
  | "contract"
  | "integration"
  | "database"
  | "lifecycle"
  | "execution"
  | "parity"
  | "memory"
  | "calendar"
  | "cost";

export interface ScenarioCoverageOwner {
  scenarioId: string;
  /** Relative to the web package root. */
  testFile: string;
  testName: string;
  kinds: CoverageKind[];
  /** True when the owner exercises real DB / lifecycle / notifier paths. */
  executableAssertion: boolean;
  /** Critical scenarios (plan Final Qualification) must have integration. */
  requiresIntegration: boolean;
}

/** Scenario ids that must have at least one integration-class owner. */
export const CRITICAL_INTEGRATION_SCENARIOS = [
  "clear_trend",
  "condition_during_revision",
  "expired_or_invalidated",
  "platform_mcp_parity",
  "opportunity_created_once",
  "duplicate_notification_guard",
  "economic_event_near",
  "calendar_provider_absent",
  "corrupt_market_data",
  "cost_ruins_entry",
  "retest_started",
  "breakout_no_retest",
  "extra_timeframe_round",
  "live_cost_fallback",
] as const;

export const REFERENCE_SCENARIO_COVERAGE: ScenarioCoverageOwner[] = [
  {
    scenarioId: "clear_trend",
    testFile: "src/lib/agent/__tests__/criticalReferenceScenarios.integration.test.ts",
    testName: "clear_trend creates revision 1, snapshot, trace, and one opportunity_created",
    kinds: ["integration", "database", "lifecycle"],
    executableAssertion: true,
    requiresIntegration: true,
  },
  {
    scenarioId: "volatile_range",
    testFile: "src/lib/agent/__tests__/doctrineScenarios.test.ts",
    testName: "tight range mid-position → conditional plan at an edge, never 'no opportunity'",
    kinds: ["contract"],
    executableAssertion: true,
    requiresIntegration: false,
  },
  {
    scenarioId: "mid_range_tight",
    testFile: "src/lib/agent/__tests__/doctrineScenarios.test.ts",
    testName: "tight range mid-position → conditional plan at an edge, never 'no opportunity'",
    kinds: ["contract"],
    executableAssertion: true,
    requiresIntegration: false,
  },
  {
    scenarioId: "forming_pattern",
    testFile: "src/lib/agent/__tests__/doctrineScenarios.test.ts",
    testName: "forming pattern → anticipatory plan carrying its own risk label",
    kinds: ["contract"],
    executableAssertion: true,
    requiresIntegration: false,
  },
  {
    scenarioId: "unclassified_structure",
    testFile: "src/lib/agent/__tests__/doctrineScenarios.test.ts",
    testName: "unclassified structure → described and planned, with no invented pattern name",
    kinds: ["contract"],
    executableAssertion: true,
    requiresIntegration: false,
  },
  {
    scenarioId: "conflicting_timeframes",
    testFile: "src/lib/agent/__tests__/doctrineScenarios.test.ts",
    testName: "conflicting timeframes → a resolved direction, not an absent one",
    kinds: ["contract"],
    executableAssertion: true,
    requiresIntegration: false,
  },
  {
    scenarioId: "no_matching_strategy",
    testFile: "src/lib/agent/__tests__/doctrineScenarios.test.ts",
    testName: "does not claim statistical support for a recommendation",
    kinds: ["contract"],
    executableAssertion: true,
    requiresIntegration: false,
  },
  {
    scenarioId: "weak_backtest",
    testFile: "src/lib/agent/__tests__/evidenceCard.test.ts",
    testName: "a losing backtest earns no uplift",
    kinds: ["contract"],
    executableAssertion: true,
    requiresIntegration: false,
  },
  {
    scenarioId: "no_similar_cases",
    testFile: "src/lib/marketMemory/__tests__/caseMemory.test.ts",
    testName: "says nothing at all when there is no comparable history",
    kinds: ["contract", "memory"],
    executableAssertion: true,
    requiresIntegration: false,
  },
  {
    scenarioId: "cost_ruins_entry",
    testFile: "src/lib/agent/__tests__/criticalReferenceScenarios.integration.test.ts",
    testName: "cost_ruins_entry keeps a conditional plan and never distorts levels",
    kinds: ["integration", "cost", "database"],
    executableAssertion: true,
    requiresIntegration: true,
  },
  {
    scenarioId: "economic_event_near",
    testFile: "src/lib/recommendations/canonical/__tests__/economicEventMonitor.test.ts",
    testName: "notifies on the first sweep and dedupes the second",
    kinds: ["integration", "calendar", "lifecycle", "database"],
    executableAssertion: true,
    requiresIntegration: true,
  },
  {
    scenarioId: "calendar_provider_absent",
    testFile: "src/lib/agent/__tests__/criticalReferenceScenarios.integration.test.ts",
    testName: "calendar_provider_absent invents no events and refuses publication by name",
    kinds: ["integration", "calendar", "database"],
    executableAssertion: true,
    requiresIntegration: true,
  },
  {
    scenarioId: "corrupt_market_data",
    testFile: "src/lib/agent/__tests__/criticalReferenceScenarios.integration.test.ts",
    testName: "corrupt_market_data returns an operational block without a recommendation",
    kinds: ["integration", "database"],
    executableAssertion: true,
    requiresIntegration: true,
  },
  {
    scenarioId: "condition_during_revision",
    testFile: "src/lib/agent/__tests__/criticalReferenceScenarios.integration.test.ts",
    // Renamed with the concept: there are no intents to be stale about any
    // more. What survives — and is what the scenario was always about — is that
    // the newer revision wins and acting on the older one is refused.
    testName: "condition_during_revision: the newer revision wins and the old one reads stale",
    kinds: ["integration", "database", "lifecycle"],
    executableAssertion: true,
    requiresIntegration: true,
  },
  {
    scenarioId: "expired_or_invalidated",
    testFile: "src/lib/agent/__tests__/criticalReferenceScenarios.integration.test.ts",
    // `execution_skipped` was a transition of the deleted execution layer. The
    // invariant it protected is the platform-level one: a terminal plan stays
    // terminal and no sweep may walk it back to active.
    testName: "expired_or_invalidated: a terminal plan is never re-activated",
    kinds: ["integration", "lifecycle", "database"],
    executableAssertion: true,
    requiresIntegration: true,
  },
  {
    scenarioId: "platform_mcp_parity",
    testFile: "src/lib/agent/__tests__/parityLog.test.ts",
    testName: "surfaces an unexplained divergence in the totals",
    kinds: ["integration", "parity", "database"],
    executableAssertion: true,
    requiresIntegration: true,
  },
  {
    scenarioId: "hidden_wait_guard",
    testFile: "src/lib/agent/__tests__/doctrineGuard.test.ts",
    testName: "no source or prompt file reintroduces WAIT as an outcome",
    kinds: ["contract"],
    executableAssertion: true,
    requiresIntegration: false,
  },
  {
    scenarioId: "duplicate_notification_guard",
    testFile: "src/lib/recommendations/__tests__/lifecycleNotifier.test.ts",
    testName: "announces a change once and stays silent on re-sweeps",
    kinds: ["integration", "lifecycle", "database"],
    executableAssertion: true,
    requiresIntegration: true,
  },
  {
    scenarioId: "opportunity_created_once",
    testFile: "src/lib/recommendations/canonical/__tests__/opportunityCreated.test.ts",
    testName: "announces a new plan and stays silent the second time",
    kinds: ["integration", "lifecycle", "database"],
    executableAssertion: true,
    requiresIntegration: true,
  },
  {
    scenarioId: "retest_started",
    testFile: "src/lib/agent/__tests__/criticalReferenceScenarios.integration.test.ts",
    testName: "retest_started notifies once through lifecycle dedupe",
    kinds: ["integration", "lifecycle", "database"],
    executableAssertion: true,
    requiresIntegration: true,
  },
  {
    scenarioId: "breakout_no_retest",
    testFile: "src/lib/agent/__tests__/criticalReferenceScenarios.integration.test.ts",
    testName: "breakout_no_retest notifies once through lifecycle dedupe",
    kinds: ["integration", "lifecycle", "database"],
    executableAssertion: true,
    requiresIntegration: true,
  },
  {
    scenarioId: "extra_timeframe_round",
    testFile: "src/lib/agent/__tests__/browseLoop.test.ts",
    // The one-shot extra frame became a bounded browse loop; what the scenario
    // was always about is that the round cannot run away, and the budget is
    // now what stops it rather than a hardcoded "no third round".
    testName: "stops at the call budget even when the model keeps asking",
    kinds: ["integration", "contract"],
    executableAssertion: true,
    requiresIntegration: true,
  },
  {
    scenarioId: "live_cost_fallback",
    testFile: "src/lib/strategies/__tests__/liveCostProfile.test.ts",
    testName: "falls back to the static model AND says so",
    kinds: ["integration", "cost", "database"],
    executableAssertion: true,
    requiresIntegration: true,
  },
  {
    scenarioId: "case_memory_insufficient",
    testFile: "src/lib/marketMemory/__tests__/caseMemory.test.ts",
    testName: "reports counts but no rate below a usable sample",
    kinds: ["contract", "memory"],
    executableAssertion: true,
    requiresIntegration: false,
  },
];

export function registryScenarioIds(): string[] {
  return REFERENCE_SCENARIOS.map((row) => row.id);
}

export function coverageOwnersFor(scenarioId: string): ScenarioCoverageOwner[] {
  return REFERENCE_SCENARIO_COVERAGE.filter((row) => row.scenarioId === scenarioId);
}
