export {
  BridgeErrorCode,
  bridgeError,
  bridgeSuccess,
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
  getCachedAsync,
  invalidateCached,
  isRedisCacheConfigured,
  setCached,
  setCachedAsync,
  type BridgeCacheEntry,
  type BridgeCacheHit,
  type BridgeCacheMiss,
  type BridgeCacheResult,
} from "./cache";

export {
  bridgeRedisKey,
  getBridgeKvStore,
  resetBridgeKvStoreForTests,
  type BridgeKvStore,
} from "./store";

export {
  checkWriteRateLimit,
  checkWriteRateLimitAsync,
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
  isForexSessionOpen,
  type BuildTradeReadinessInput,
  type TradeReadinessBlocker,
  type TradeReadinessChecks,
  type TradeReadinessResult,
} from "./tradeReadiness";
