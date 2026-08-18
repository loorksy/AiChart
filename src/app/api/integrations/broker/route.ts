import { NextResponse } from "next/server";
import { handleError, requireUser } from "@/lib/api";
import { DEFAULT_BROKER } from "@/lib/brokerLink/brokers";
import {
  createConfigurationLink,
  createDraftAccount,
  MetaapiClientError,
  readAccount,
} from "@/lib/brokerLink/metaapiClient";
import {
  getBrokerLink,
  insertBrokerLink,
  updateBrokerLinkStatus,
} from "@/lib/brokerLink/store";
import { metaapiConfigured, metaapiRegion, metaapiToken } from "@/lib/brokerLink/token";
import { startTrialClock } from "@/lib/subscription/entitlement";

function publicState(state: string): "draft" | "configured" {
  return state === "DRAFT" ? "draft" : "configured";
}

function publicBrokerError(err: MetaapiClientError): {
  error: string;
  code: "metaapi_balance" | "metaapi_error";
  status: number;
} {
  const msg = err.message.toLowerCase();
  if (/top up|high reliability|insufficient (funds|balance)/.test(msg)) {
    return {
      error: "MetaAPI balance is required before linking can start.",
      code: "metaapi_balance",
      status: 402,
    };
  }
  return {
    error: "Could not open the linking page.",
    code: "metaapi_error",
    status: err.status >= 400 && err.status < 500 ? err.status : 502,
  };
}

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const configured = await metaapiConfigured();
    let row = await getBrokerLink(user.id);
    const refresh =
      configured &&
      row &&
      new URL(req.url).searchParams.get("refresh") === "1";
    if (refresh && row) {
      const token = await metaapiToken();
      if (token) {
        try {
          const live = await readAccount({
            token,
            accountId: row.metaapi_account_id,
          });
          await updateBrokerLinkStatus(user.id, {
            state: live.state,
            login: live.login,
          });
          if (live.state !== "DRAFT") {
            await startTrialClock(user.id);
          }
          row = await getBrokerLink(user.id);
        } catch (err) {
          if (!(err instanceof MetaapiClientError)) throw err;
        }
      }
    }
    return NextResponse.json({
      configured,
      linked: Boolean(row),
      status: row ? publicState(row.state) : null,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST() {
  try {
    const user = await requireUser();
    const token = await metaapiToken();
    if (!token) {
      return NextResponse.json(
        { error: "Broker linking is not enabled on the server yet." },
        { status: 503 },
      );
    }

    let row = await getBrokerLink(user.id);
    if (!row) {
      const created = await createDraftAccount({
        token,
        userId: user.id,
        broker: DEFAULT_BROKER,
        region: await metaapiRegion(),
      });
      try {
        row = await insertBrokerLink({
          userId: user.id,
          metaapiAccountId: created.id,
          brokerId: DEFAULT_BROKER.id,
          server: DEFAULT_BROKER.server,
          state: created.state,
        });
      } catch {
        row = await getBrokerLink(user.id);
        if (!row) throw new Error("Could not persist the broker link.");
      }
    }

    const configurationLink = await createConfigurationLink({
      token,
      accountId: row.metaapi_account_id,
    });

    try {
      const live = await readAccount({
        token,
        accountId: row.metaapi_account_id,
      });
      await updateBrokerLinkStatus(user.id, {
        state: live.state,
        login: live.login,
      });
      if (live.state !== "DRAFT") {
        await startTrialClock(user.id);
      }
    } catch (err) {
      if (!(err instanceof MetaapiClientError)) throw err;
    }

    return NextResponse.json({ configurationLink });
  } catch (err) {
    if (err instanceof MetaapiClientError) {
      const body = publicBrokerError(err);
      return NextResponse.json(
        { error: body.error, code: body.code },
        { status: body.status },
      );
    }
    return handleError(err);
  }
}
