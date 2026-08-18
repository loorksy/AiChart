import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, requireUser } from "@/lib/api";
import {
  brokerById,
  brokerFromServer,
  publicBroker,
  type BrokerOption,
} from "@/lib/brokerLink/brokers";
import {
  createConfigurationLink,
  createDraftAccount,
  deleteAccount,
  MetaapiClientError,
  readAccount,
} from "@/lib/brokerLink/metaapiClient";
import {
  getBrokerLink,
  insertBrokerLink,
  replaceBrokerLink,
  updateBrokerLinkStatus,
} from "@/lib/brokerLink/store";
import { metaapiConfigured, metaapiRegion, metaapiToken } from "@/lib/brokerLink/token";
import { startTrialClock } from "@/lib/subscription/entitlement";

const PostBody = z
  .object({
    brokerId: z.string().min(1).max(80).optional(),
    server: z.string().min(2).max(80).optional(),
  })
  .strict();

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

function resolveBroker(body: {
  brokerId?: string;
  server?: string;
}): BrokerOption | null {
  if (body.brokerId) {
    const catalog = brokerById(body.brokerId);
    if (catalog) return catalog;
  }
  if (body.server) return brokerFromServer(body.server);
  return null;
}

async function persistDraft(input: {
  userId: number;
  token: string;
  broker: BrokerOption;
  existingId?: string;
}) {
  if (input.existingId) {
    try {
      await deleteAccount({ token: input.token, accountId: input.existingId });
    } catch (err) {
      if (!(err instanceof MetaapiClientError)) throw err;
    }
  }
  const created = await createDraftAccount({
    token: input.token,
    userId: input.userId,
    broker: input.broker,
    region: await metaapiRegion(),
  });
  return created;
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
    const broker = row
      ? brokerById(row.broker_id) ?? {
          id: row.broker_id,
          name: row.server,
          server: row.server,
          env: "live" as const,
        }
      : null;
    return NextResponse.json({
      configured,
      linked: Boolean(row),
      status: row ? publicState(row.state) : null,
      broker: broker ? publicBroker(broker) : null,
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
    const broker = resolveBroker(parsed.data);
    if (!broker) {
      return NextResponse.json(
        { error: "Pick a broker from the list." },
        { status: 400 },
      );
    }

    let row = await getBrokerLink(user.id);
    const needsNew =
      !row || row.broker_id !== broker.id || row.server !== broker.server;
    if (needsNew) {
      const created = await persistDraft({
        userId: user.id,
        token,
        broker,
        existingId: row?.metaapi_account_id,
      });
      if (!row) {
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
      } else {
        row = await replaceBrokerLink({
          userId: user.id,
          metaapiAccountId: created.id,
          brokerId: broker.id,
          server: broker.server,
          state: created.state,
        });
      }
    }

    if (!row) throw new Error("Could not persist the broker link.");

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
