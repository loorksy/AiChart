import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import {
  eaKillCloseFlagKey,
  queueEaCloseAllPositions,
} from "@/lib/eaTradeCommands";
import { updateSettings, getSettings, setFlag } from "@/lib/store";
import { closeAllOpenTrades } from "@/lib/tradeClose";

const schema = z.object({ on: z.boolean() });

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const { on } = schema.parse(await req.json());
    await updateSettings(user.id, { kill_switch: on ? 1 : 0 });
    const settings = await getSettings(user.id);
    let closeResult = null;
    if (on) {
      await queueEaCloseAllPositions(user.id);
      await setFlag(eaKillCloseFlagKey(user.id), "1");
      closeResult = await closeAllOpenTrades(user.id);
    }
    return NextResponse.json({
      kill_switch: settings.kill_switch,
      closeResult,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "قيمة غير صالحة." }, { status: 400 });
    }
    return handleError(err);
  }
}
