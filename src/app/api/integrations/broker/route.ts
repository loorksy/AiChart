import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, requireUser } from "@/lib/api";
import {
  brokerIdForServer,
  normalizeLogin,
  normalizeServer,
} from "@/lib/brokerLink/brokers";
import {
  createTradingAccount,
  deleteAccount,
  MetaapiClientError,
  readAccount,
} from "@/lib/brokerLink/metaapiClient";
import {
  getBrokerLink,
  insertBrokerLink,
  replaceBrokerLink,
  deleteBrokerLink,
  updateBrokerLinkStatus,
} from "@/lib/brokerLink/store";
import { metaapiConfigured, metaapiRegion, metaapiToken } from "@/lib/brokerLink/token";
import { startTrialClock } from "@/lib/subscription/entitlement";

const PostBody = z
  .object({
    server: z.string().min(2).max(80),
    login: z.string().min(1).max(32),
    password: z.string().min(1).max(128),
  })
  .strict();

function publicState(state: string): "draft" | "configured" {
  return state === "DRAFT" ? "draft" : "configured";
}

export type BrokerErrorCode =
  | "metaapi_balance"
  | "metaapi_auth"
  | "metaapi_server"
  | "metaapi_error";

function publicBrokerError(err: MetaapiClientError): {
  error: string;
  code: BrokerErrorCode;
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
  if (/e_auth|authenticate|invalid account|account disabled/.test(msg)) {
    return {
      error: "Login or password was rejected by the broker.",
      code: "metaapi_auth",
      status: 400,
    };
  }
  if (/e_srv_not_found|\.dat file|server .+ not found/.test(msg)) {
    return {
      error: "That MetaTrader server name was not found.",
      code: "metaapi_server",
      status: 400,
    };
  }
  return {
    error: "Could not link the trading account.",
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
      server: row?.server ?? null,
      login: row?.login ?? null,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const token = await metaapiToken();
    if (!token) {
      return NextResponse.json(
        { error: "Broker linking is not enabled on the server yet." },
        { status: 503 },
      );
    }

    const json: unknown = await req.json().catch(() => ({}));
    const parsed = PostBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    const server = normalizeServer(parsed.data.server);
    const login = normalizeLogin(parsed.data.login);
    const password = parsed.data.password;
    if (!server || !login) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const existing = await getBrokerLink(user.id);
    const created = await createTradingAccount({
      token,
      userId: user.id,
      server,
      login,
      password,
      region: await metaapiRegion(),
    });

    const persist = {
      userId: user.id,
      metaapiAccountId: created.id,
      brokerId: brokerIdForServer(server),
      server,
      state: created.state,
      login,
    };
    let row = existing
      ? await replaceBrokerLink(persist)
      : await insertBrokerLink(persist).catch(async (): Promise<
          Awaited<ReturnType<typeof insertBrokerLink>>
        > => {
          const again = await getBrokerLink(user.id);
          if (!again) throw new Error("Could not persist the broker link.");
          return replaceBrokerLink(persist);
        });

    if (existing && existing.metaapi_account_id !== created.id) {
      try {
        await deleteAccount({
          token,
          accountId: existing.metaapi_account_id,
        });
      } catch (err) {
        if (!(err instanceof MetaapiClientError)) throw err;
      }
    }

    try {
      const live = await readAccount({
        token,
        accountId: row.metaapi_account_id,
      });
      await updateBrokerLinkStatus(user.id, {
        state: live.state,
        login: live.login ?? login,
      });
      if (live.state !== "DRAFT") {
        await startTrialClock(user.id);
      }
      row = (await getBrokerLink(user.id)) ?? row;
    } catch (err) {
      if (!(err instanceof MetaapiClientError)) throw err;
    }

    return NextResponse.json({
      status: publicState(row.state),
      server: row.server,
      login: row.login,
    });
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

/**
 * Unlink removes the Lonora row AND deletes the MetaAPI cloud account so the
 * broker replica is undeployed (not left connected 24/7 after the user leaves).
 */
export async function DELETE() {
  try {
    const user = await requireUser();
    const row = await getBrokerLink(user.id);
    if (!row) {
      return NextResponse.json({ linked: false });
    }

    const token = await metaapiToken();
    if (!token) {
      return NextResponse.json(
        { error: "Broker linking is not enabled on the server yet." },
        { status: 503 },
      );
    }

    try {
      await deleteAccount({
        token,
        accountId: row.metaapi_account_id,
      });
    } catch (err) {
      if (!(err instanceof MetaapiClientError)) throw err;
      const body = publicBrokerError(err);
      return NextResponse.json(
        { error: body.error, code: body.code },
        { status: body.status },
      );
    }

    await deleteBrokerLink(user.id);
    return NextResponse.json({ linked: false });
  } catch (err) {
    return handleError(err);
  }
}
