import { NextResponse } from "next/server";

import { requirePlatformAccess, handleError } from "@/lib/api";

import {

  getExecutionEnvSnapshot,

  executionEnvLabelAr,

} from "@/lib/executionEnv";

import { DEFAULT_MARKET } from "@/lib/marketPolicy";

import { getSettings } from "@/lib/store";

import { getForexConnectionView } from "@/lib/forexConnection";



export async function GET() {

  try {

    const user = await requirePlatformAccess();

    const settings = await getSettings(user.id);

    const [forex, executionEnv] = await Promise.all([

      getForexConnectionView(user.id),

      getExecutionEnvSnapshot(user.id),

    ]);



    const activeEnv = executionEnv.forex.resolved;



    return NextResponse.json({

      mt5: {

        connected: forex.connected,

        online: forex.online,

      },

      telegram: {

        linked: Boolean(settings.telegram_chat_id),

      },

      executionEnv: {

        label: executionEnvLabelAr(activeEnv),

        mismatch: Boolean(executionEnv.mismatch),

      },

      active_market: DEFAULT_MARKET,

    });

  } catch (e) {

    return handleError(e);

  }

}


