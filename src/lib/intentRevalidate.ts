import { getIntent } from "./store";
import type { TradeIntent } from "./types";

export const APPROVAL_REVALIDATE_AFTER_SEC = 60;
export const APPROVAL_EXPIRE_AFTER_SEC = 30 * 60;

export interface RevalidateSnapshot {
  livePrice: number;
  verdict: string;
  scanScore: number | null;
  scanSignals: string[];
}

export interface RevalidateResult {
  valid: boolean;
  reasonAr: string;
  snapshot: RevalidateSnapshot;
}

function intentAgeSec(createdAt: string): number {
  const timestamp = new Date(createdAt.includes("T") ? createdAt : `${createdAt}Z`);
  return (Date.now() - timestamp.getTime()) / 1000;
}

/**
 * Late approval only checks lifecycle validity. It never runs a deterministic
 * market strategy that can overturn the model's recommendation.
 */
export async function revalidatePendingIntent(userId: number, intentId: number): Promise<RevalidateResult> {
  const intent = await getIntent(intentId, userId);
  const snapshot = { livePrice: 0, verdict: "valid", scanScore: null, scanSignals: [] };
  if (!intent || intent.user_id !== userId) {
    return { valid: false, reasonAr: "الطلب غير موجود.", snapshot: { ...snapshot, verdict: "missing" } };
  }
  if (intentAgeSec(intent.created_at) > APPROVAL_EXPIRE_AFTER_SEC) {
    return { valid: false, reasonAr: "انتهت صلاحية الطلب. اطلب تحليلاً حديثاً.", snapshot: { ...snapshot, verdict: "expired" } };
  }
  return { valid: true, reasonAr: "الطلب صالح؛ ستُعاد فحوص الاتصال والسعر لحظة التنفيذ.", snapshot };
}

export function shouldRevalidateBeforeApprove(intent: TradeIntent): boolean {
  return intentAgeSec(intent.created_at) >= APPROVAL_REVALIDATE_AFTER_SEC;
}
