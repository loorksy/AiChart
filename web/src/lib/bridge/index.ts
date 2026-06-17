export {
  BridgeErrorCode,
  bridgeError,
  bridgeSuccess,
  lowConfidenceFailure,
  toBridgeFailure,
  toBridgeResponse,
  type BridgeEnvelope,
  type BridgeErrorBody,
  type BridgeFailure,
  type BridgeSuccess,
} from "./errors";

export {
  bridgeCacheKey,
  clearBridgeCache,
  getBridgeCacheTtlMs,
  getCached,
  invalidateCached,
  isRedisCacheConfigured,
  setCached,
  type BridgeCacheEntry,
  type BridgeCacheHit,
  type BridgeCacheMiss,
  type BridgeCacheResult,
} from "./cache";

export {
  checkWriteRateLimit,
  clearRateLimits,
  isWriteMethod,
  rateLimitKey,
} from "./rateLimit";

export {
  freshnessMeta,
  getStaleQuoteThresholdMs,
  isQuoteFresh,
  getMaxSpreadPips,
  type FreshnessMeta,
  type FreshnessSource,
} from "./freshness";

export {
  getIdempotencyResult,
  readIdempotencyKey,
  storeIdempotencyResult,
  type IdempotencyRecord,
} from "./idempotency";

export {
  isBridgeEnvelope,
  withBridge,
  type BridgeContext,
  type BridgeRouteHandler,
  type WithBridgeOptions,
} from "./withBridge";

export {
  checkForexTradePreflight,
  evaluateForexQuoteGate,
  resolveForexQuoteSnapshot,
  type ForexQuoteSnapshot,
} from "./forexPreflight";

export {
  buildTradeReadiness,
  collectTradeReadinessBlockers,
  confidenceGateCheck,
  isForexSessionOpen,
  DEFAULT_MIN_CONFIDENCE,
  type BuildTradeReadinessInput,
  type CollectBlockersInput,
  type ConfidenceGateCheck,
  type TradeReadinessBlocker,
  type TradeReadinessChecks,
  type TradeReadinessResult,
} from "./tradeReadiness";
