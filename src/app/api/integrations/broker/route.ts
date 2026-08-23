import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, requireUser } from "@/lib/api";
import { normalizeLogin, normalizeServer } from "@/lib/brokerLink/brokers";
import {
  deleteAccount,
  MetaapiClientError,
  readAccount,
} from "@/lib/brokerLink/metaapiClient";
import { linkBrokerAccountCharged } from "@/lib/brokerLink/linkFlow";
import { getCreditPrice } from "@/lib/billing/planConfig";
import {
  getBrokerLink,
  deleteBrokerLink,
  updateBrokerLinkStatus,
} from "@/lib/brokerLink/store";
import { metaapiConfigured, metaapiRegion, metaapiToken } from "@/lib/brokerLink/token";
import { resolveSpendGate } from "@/lib/billing/spend";
import { t } from "@/lib/i18n";

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
  | "metaapi_config"
  | "metaapi_error";

function publicBrokerError(err: MetaapiClientError): {
  error: string;
  code: BrokerErrorCode;
  status: number;
} {
  const msg = err.message.toLowerCase();
  // A 401 here is the PLATFORM token being rejected by MetaAPI — reporting it
  // as the user's broker credentials sends them to reset the wrong password.
  if (err.status === 401) {
    return {
      error: "Broker linking is temporarily unavailable — the platform's MetaAPI token was rejected.",
      code: "metaapi_config",
      status: 503,
    };
  }
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
            // A transiently missing login must not wipe the stored one.
            login: live.login ?? row.login,
          });
          row = await getBrokerLink(user.id);
        } catch (err) {
          // The cloud account is gone at MetaAPI — a stale local link would
          // report "configured" forever. Drop it so the user can relink.
          if (err instanceof MetaapiClientError && err.status === 404) {
            await deleteBrokerLink(user.id).catch(() => {});
            row = null;
          }
          // Refresh is best-effort: a timeout or transport error must never
          // fail the read of what we already know.
        }
      }
    }
    return NextResponse.json({
      configured,
      linked: Boolean(row),
      status: row ? publicState(row.state) : null,
      server: row?.server ?? null,
      login: row?.login ?? null,
      // The one-time credit charge the link modal must state up front.
      link_cost_credits: await getCreditPrice("mt5_link"),
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    // Billing v3: linking is a SUBSCRIBER feature — the trial is refused
    // HERE, by the server, whatever the client renders. Expired and empty
    // states answer with their own named codes so the three messages never
    // blur. (The one-time link charge itself lands with the charge flow.)
    const linkGate = await resolveSpendGate(user.id, "mt5_link");
    if (!linkGate.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: linkGate.code,
            message: t("ar", `billing.refusal.${linkGate.code}`),
          },
        },
        { status: linkGate.code === "insufficient_credits" ? 402 : 403 },
      );
    }
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
    // Billing v3: provisioning first (a failed link charges nothing), then
    // the row and the ONE-TIME charge in one transaction; a refused charge
    // deletes the fresh account and leaves any previous link untouched.
    const linked = await linkBrokerAccountCharged({
      token,
      userId: user.id,
      server,
      login,
      password,
      region: (await metaapiRegion()) ?? undefined,
      hasExistingLink: existing != null,
    });
    if (!linked.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "insufficient_credits",
            message: t("ar", "billing.refusal.insufficient_credits"),
          },
        },
        { status: 402 },
      );
    }
    const created = { id: linked.accountId, state: linked.state };
    let row = linked.row;

    if (existing && existing.metaapi_account_id !== created.id) {
      try {
        await deleteAccount({
          token,
          accountId: existing.metaapi_account_id,
        });
      } catch {
        // Best-effort cleanup of the replaced account: the new link is
        // already persisted, and failing the request now would leave the
        // user unsure whether linking worked. (The stale account keeps
        // billing until removed — surfaced in logs by the client label.)
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
      row = (await getBrokerLink(user.id)) ?? row;
    } catch {
      // Best-effort status probe — the link row is already stored.
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
