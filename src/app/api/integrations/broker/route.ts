import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, requireUser } from "@/lib/api";
import { brokerById, BROKER_CATALOG, publicBroker } from "@/lib/brokerLink/brokers";
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

const PostBody = z
  .object({
    brokerId: z.string().min(1).max(64).optional(),
  })
  .strict();

function publicState(state: string): "draft" | "configured" {
  return state === "DRAFT" ? "draft" : "configured";
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
    const broker = row ? brokerById(row.broker_id) : undefined;
    return NextResponse.json({
      configured,
      linked: Boolean(row),
      status: row ? publicState(row.state) : null,
      state: row?.state ?? null,
      login: row?.login ?? null,
      broker: broker ? publicBroker(broker) : row
        ? { id: row.broker_id, name: row.server, env: "live" as const }
        : null,
      brokers: BROKER_CATALOG.map(publicBroker),
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

    let row = await getBrokerLink(user.id);
    if (!row) {
      const broker = parsed.data.brokerId
        ? brokerById(parsed.data.brokerId)
        : undefined;
      if (!broker) {
        return NextResponse.json(
          { error: "Pick a broker from the list." },
          { status: 400 },
        );
      }
      const created = await createDraftAccount({
        token,
        userId: user.id,
        broker,
        region: await metaapiRegion(),
      });
      try {
        row = await insertBrokerLink({
          userId: user.id,
          metaapiAccountId: created.id,
          brokerId: broker.id,
          server: broker.server,
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

    let login = row.login;
    let state = row.state;
    try {
      const live = await readAccount({
        token,
        accountId: row.metaapi_account_id,
      });
      state = live.state;
      login = live.login;
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

    const broker = brokerById(row.broker_id);
    return NextResponse.json({
      configurationLink,
      status: publicState(state),
      state,
      login,
      broker: broker ? publicBroker(broker) : { id: row.broker_id, name: row.server, env: "live" },
    });
  } catch (err) {
    if (err instanceof MetaapiClientError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status >= 400 && err.status < 500 ? err.status : 502 },
      );
    }
    return handleError(err);
  }
}
