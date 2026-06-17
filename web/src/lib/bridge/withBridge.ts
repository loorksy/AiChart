import crypto from "crypto";
import type { NextRequest } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import {
  getIdempotencyResult,
  readIdempotencyKey,
  storeIdempotencyResult,
} from "./idempotency";
import {
  bridgeSuccess,
  toBridgeFailure,
  toBridgeResponse,
  type BridgeEnvelope,
} from "./errors";
import { checkWriteRateLimit, isWriteMethod } from "./rateLimit";

export interface BridgeContext {
  req: NextRequest;
  userId: number;
  requestId: string;
}

export type BridgeRouteHandler<T = unknown> = (
  ctx: BridgeContext,
) => Promise<T> | T;

export interface WithBridgeOptions {
  /** Apply sliding-window rate limit on write methods (default: true). */
  rateLimit?: boolean;
  /** Dedupe writes via X-Idempotency-Key or body.idempotencyKey. */
  idempotent?: boolean;
  /** Optional route label for rate-limit bucketing (defaults to pathname). */
  routeKey?: string;
}

function newRequestId(): string {
  return crypto.randomUUID();
}

export function withBridge<T>(
  handler: BridgeRouteHandler<T>,
  options: WithBridgeOptions = {},
) {
  const rateLimitEnabled = options.rateLimit !== false;
  const idempotent = options.idempotent === true;

  return async (req: NextRequest) => {
    const requestId = newRequestId();
    const startedAt = Date.now();
    const route = options.routeKey ?? req.nextUrl.pathname;

    try {
      const userId = await resolveBridgeUserId(req);

      if (rateLimitEnabled && isWriteMethod(req.method)) {
        const rl = checkWriteRateLimit(userId, route);
        if (!rl.allowed) {
          return toBridgeResponse(rl.failure, {
            requestId,
            durationMs: Date.now() - startedAt,
          });
        }
      }

      let idempotencyKey: string | null = null;
      if (idempotent && isWriteMethod(req.method)) {
        idempotencyKey = readIdempotencyKey(
          req.headers.get("x-idempotency-key"),
        );
        if (idempotencyKey) {
          const cached = await getIdempotencyResult<T>(userId, idempotencyKey);
          if (cached) {
            return toBridgeResponse(cached, {
              requestId,
              durationMs: Date.now() - startedAt,
              idempotentReplay: true,
            });
          }
        }
      }

      const data = await handler({ req, userId, requestId });
      const envelope = bridgeSuccess(data, {
        requestId,
        durationMs: Date.now() - startedAt,
      });

      if (idempotent && idempotencyKey) {
        await storeIdempotencyResult(userId, idempotencyKey, envelope);
      }

      return toBridgeResponse(envelope);
    } catch (err) {
      const failure = toBridgeFailure(err);
      return toBridgeResponse(failure, {
        requestId,
        durationMs: Date.now() - startedAt,
      });
    }
  };
}

/** Type guard for downstream consumers expecting the canonical envelope. */
export function isBridgeEnvelope(value: unknown): value is BridgeEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof (value as BridgeEnvelope).ok === "boolean"
  );
}
