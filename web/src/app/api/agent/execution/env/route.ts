import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import {
  executionToBinanceEnv,
  getExecutionEnvSnapshot,
  type ExecutionEnv,
} from "@/lib/executionEnv";
import {
  getBinanceCredentials,
  logAudit,
  updateSettings,
} from "@/lib/store";

export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    return NextResponse.json(await getExecutionEnvSnapshot(userId));
  } catch (e) {
    return handleError(e);
  }
}

const schema = z.object({
  preference: z.enum(["demo", "live"]),
});

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());
    const preference = body.preference as ExecutionEnv;

    await updateSettings(userId, { execution_env_preference: preference });
    await logAudit(userId, "agent_execution_env", `preference=${preference}`);

    const binanceEnv = executionToBinanceEnv(preference);
    const creds = await getBinanceCredentials(userId, binanceEnv);
    const snap = await getExecutionEnvSnapshot(userId);

    if (!creds && snap.activeMarket === "crypto") {
      return NextResponse.json({
        ok: false,
        preference,
        executionEnv: snap,
        message: `لا توجد مفاتيح Binance لبيئة ${binanceEnv}. اربطها من الإعدادات أولاً.`,
      });
    }

    return NextResponse.json({
      ok: true,
      preference,
      executionEnv: snap,
      message: snap.mismatch ? snap.mismatchDetailAr : "تم تحديث البيئة المفضّلة.",
    });
  } catch (e) {
    return handleError(e);
  }
}
