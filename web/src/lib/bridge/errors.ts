import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError } from "@/lib/api";

export enum BridgeErrorCode {
  STALE_QUOTE = "STALE_QUOTE",
  EA_OFFLINE = "EA_OFFLINE",
  RISK_LIMIT_EXCEEDED = "RISK_LIMIT_EXCEEDED",
  LOW_CONFIDENCE = "LOW_CONFIDENCE",
  RATE_LIMITED = "RATE_LIMITED",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  UPSTREAM_TIMEOUT = "UPSTREAM_TIMEOUT",
  SPREAD_TOO_WIDE = "SPREAD_TOO_WIDE",
  MARKET_CLOSED = "MARKET_CLOSED",
}

export interface BridgeErrorBody {
  code: BridgeErrorCode | string;
  message: string;
  message_ar?: string;
  retriable: boolean;
  retryAfterMs?: number;
  details?: Record<string, unknown>;
}

export type BridgeSuccess<T = unknown> = {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
};

export type BridgeFailure = {
  ok: false;
  error: BridgeErrorBody;
  meta?: Record<string, unknown>;
};

export type BridgeEnvelope<T = unknown> = BridgeSuccess<T> | BridgeFailure;

const DEFAULT_RETRIABLE: Partial<Record<BridgeErrorCode, boolean>> = {
  [BridgeErrorCode.STALE_QUOTE]: true,
  [BridgeErrorCode.EA_OFFLINE]: true,
  [BridgeErrorCode.RATE_LIMITED]: true,
  [BridgeErrorCode.UPSTREAM_TIMEOUT]: true,
  [BridgeErrorCode.SPREAD_TOO_WIDE]: true,
  [BridgeErrorCode.RISK_LIMIT_EXCEEDED]: false,
  [BridgeErrorCode.LOW_CONFIDENCE]: false,
  [BridgeErrorCode.VALIDATION_ERROR]: false,
  [BridgeErrorCode.MARKET_CLOSED]: false,
};

const HTTP_STATUS: Partial<Record<BridgeErrorCode, number>> = {
  [BridgeErrorCode.STALE_QUOTE]: 409,
  [BridgeErrorCode.EA_OFFLINE]: 503,
  [BridgeErrorCode.RISK_LIMIT_EXCEEDED]: 403,
  [BridgeErrorCode.LOW_CONFIDENCE]: 403,
  [BridgeErrorCode.RATE_LIMITED]: 429,
  [BridgeErrorCode.VALIDATION_ERROR]: 400,
  [BridgeErrorCode.UPSTREAM_TIMEOUT]: 504,
  [BridgeErrorCode.SPREAD_TOO_WIDE]: 409,
  [BridgeErrorCode.MARKET_CLOSED]: 409,
};

export function bridgeError(
  code: BridgeErrorCode | string,
  message: string,
  message_ar?: string,
  details?: Record<string, unknown>,
  overrides?: Partial<Pick<BridgeErrorBody, "retriable" | "retryAfterMs">>,
): BridgeFailure {
  const knownCode = Object.values(BridgeErrorCode).includes(code as BridgeErrorCode)
    ? (code as BridgeErrorCode)
    : null;
  return {
    ok: false,
    error: {
      code,
      message,
      ...(message_ar ? { message_ar } : {}),
      retriable:
        overrides?.retriable ??
        (knownCode ? (DEFAULT_RETRIABLE[knownCode] ?? false) : false),
      ...(overrides?.retryAfterMs !== undefined
        ? { retryAfterMs: overrides.retryAfterMs }
        : {}),
      ...(details ? { details } : {}),
    },
  };
}

export function bridgeSuccess<T>(
  data: T,
  meta?: Record<string, unknown>,
): BridgeSuccess<T> {
  return meta ? { ok: true, data, meta } : { ok: true, data };
}

function httpStatusForEnvelope(envelope: BridgeEnvelope): number {
  if (envelope.ok) return 200;
  const code = envelope.error.code;
  if (code in HTTP_STATUS) {
    return HTTP_STATUS[code as BridgeErrorCode]!;
  }
  return 500;
}

function mapApiError(err: ApiError): BridgeFailure {
  const status = err.status;
  if (status === 429) {
    return bridgeError(
      BridgeErrorCode.RATE_LIMITED,
      err.message,
      err.message,
    );
  }
  if (status === 400 || status === 404) {
    return bridgeError(
      BridgeErrorCode.VALIDATION_ERROR,
      err.message,
      err.message,
    );
  }
  if (status === 403) {
    return bridgeError(
      BridgeErrorCode.RISK_LIMIT_EXCEEDED,
      err.message,
      err.message,
    );
  }
  if (status === 503) {
    return bridgeError(
      BridgeErrorCode.EA_OFFLINE,
      err.message,
      err.message,
    );
  }
  return bridgeError(
    BridgeErrorCode.VALIDATION_ERROR,
    err.message,
    err.message,
  );
}

function mapZodError(err: ZodError): BridgeFailure {
  return bridgeError(
    BridgeErrorCode.VALIDATION_ERROR,
    "Invalid request payload.",
    "بيانات الطلب غير صالحة.",
    { issues: err.issues },
  );
}

/** Map arbitrary thrown values into a canonical bridge failure envelope. */
export function toBridgeFailure(err: unknown): BridgeFailure {
  if (
    typeof err === "object" &&
    err !== null &&
    "ok" in err &&
    (err as BridgeFailure).ok === false
  ) {
    return err as BridgeFailure;
  }
  if (err instanceof ApiError) return mapApiError(err);
  if (err instanceof ZodError) return mapZodError(err);
  const message = err instanceof Error ? err.message : "Unexpected bridge error.";
  return bridgeError(
    BridgeErrorCode.UPSTREAM_TIMEOUT,
    message,
    "حدث خطأ غير متوقع في جسر الوكيل.",
  );
}

/** Serialize a bridge envelope (or thrown error) to a NextResponse. */
export function toBridgeResponse(
  payload: BridgeEnvelope | unknown,
  meta?: Record<string, unknown>,
): NextResponse {
  let envelope: BridgeEnvelope;

  if (
    typeof payload === "object" &&
    payload !== null &&
    "ok" in payload &&
    typeof (payload as BridgeEnvelope).ok === "boolean"
  ) {
    envelope = payload as BridgeEnvelope;
    if (meta && envelope.ok) {
      envelope = { ...envelope, meta: { ...envelope.meta, ...meta } };
    } else if (meta && !envelope.ok) {
      envelope = { ...envelope, meta: { ...envelope.meta, ...meta } };
    }
  } else if (payload instanceof Error || payload instanceof ZodError) {
    envelope = toBridgeFailure(payload);
    if (meta) envelope = { ...envelope, meta };
  } else {
    envelope = bridgeSuccess(payload, meta);
  }

  const status = httpStatusForEnvelope(envelope);
  return NextResponse.json(envelope, { status });
}

export function lowConfidenceFailure(
  confidence: number,
  minConfidence: number,
): BridgeFailure {
  return bridgeError(
    BridgeErrorCode.LOW_CONFIDENCE,
    `Trade confidence below minimum threshold (${minConfidence}). Wait for a higher-confidence setup.`,
    `الثقة أقل من الحد الأدنى (${minConfidence}%) — لا ننفّذ. ننتظر فرصة أوضح.`,
    { confidence, minConfidence: minConfidence },
  );
}
