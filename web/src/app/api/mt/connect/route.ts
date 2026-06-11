import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import {
  isMetaApiConfigured,
  mapMetaApiError,
  provisionAccount,
  removeMetaApiAccount,
  clearRpcCache,
} from "@/lib/metaapi/client";
import {
  deleteMtAccount,
  getMtAccount,
  saveMtAccount,
} from "@/lib/store";
import { getForexBackend } from "@/lib/brokers/forexBackend";
import { isMt5LocalConfigured, mt5Connect } from "@/lib/mt5local/client";

const schema = z.object({
  platform: z.enum(["mt4", "mt5"]),
  server: z.string().min(2, "اسم السيرفر مطلوب."),
  login: z.string().min(1, "رقم الحساب مطلوب."),
  password: z.string().min(1, "كلمة المرور مطلوبة."),
});

/**
 * Connect user's MT account (login + password + server) — via MetaApi cloud
 * or the self-hosted MT5 bridge container, per the configured backend.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const backend = getForexBackend();

    if (backend === "mt5local") {
      if (!isMt5LocalConfigured()) {
        return NextResponse.json(
          { error: "حاوية MT5 غير مفعّلة (MT5_BRIDGE_URL مفقود)." },
          { status: 503 },
        );
      }
      const body = schema.parse(await req.json());
      const login = body.login.replace(/\D/g, "");
      if (!login) {
        return NextResponse.json(
          { error: "رقم الحساب يجب أن يحتوي على أرقام فقط." },
          { status: 400 },
        );
      }
      // The bridge runs MT5 itself — login happens right now, synchronously.
      const account = await mt5Connect({
        login,
        password: body.password,
        server: body.server.trim(),
      });
      await saveMtAccount(user.id, {
        platform: "mt5",
        server: body.server.trim(),
        login,
        password: body.password,
        metaapiAccountId: "mt5local",
        state: "DEPLOYED",
        connectionStatus: "CONNECTED",
        balance: account.balance,
        equity: account.equity,
        currency: account.currency,
      });
      return NextResponse.json({
        ok: true,
        platform: "mt5",
        login,
        server: body.server.trim(),
        state: "DEPLOYED",
        connectionStatus: "CONNECTED",
        online: true,
        balance: account.balance,
        equity: account.equity,
        currency: account.currency,
      });
    }

    if (!isMetaApiConfigured()) {
      return NextResponse.json(
        { error: "ربط الفوركس غير متاح حالياً. تواصل مع الإدارة." },
        { status: 503 },
      );
    }

    const body = schema.parse(await req.json());
    const login = body.login.replace(/\D/g, "");
    if (!login) {
      return NextResponse.json(
        { error: "رقم الحساب يجب أن يحتوي على أرقام فقط." },
        { status: 400 },
      );
    }

    const existing = await getMtAccount(user.id);
    if (existing?.metaapi_account_id && existing.metaapi_account_id !== "mt5local") {
      clearRpcCache(user.id);
      try {
        await removeMetaApiAccount(existing.metaapi_account_id);
      } catch {
        /* best effort */
      }
      await deleteMtAccount(user.id);
    }

    const account = await provisionAccount({
      platform: body.platform,
      server: body.server.trim(),
      login,
      password: body.password,
      name: `AiChart u${user.id}`,
    });

    await saveMtAccount(user.id, {
      platform: body.platform,
      server: body.server.trim(),
      login,
      password: body.password,
      metaapiAccountId: account.id,
      region: account.region ?? null,
      state: account.state,
      connectionStatus: account.connectionStatus,
    });

    return NextResponse.json({
      ok: true,
      platform: body.platform,
      login,
      server: body.server.trim(),
      state: account.state,
      connectionStatus: account.connectionStatus,
      online:
        account.state === "DEPLOYED" &&
        account.connectionStatus === "CONNECTED",
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "بيانات غير صالحة." },
        { status: 400 },
      );
    }
    const message = mapMetaApiError(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Disconnect MetaTrader account from MetaApi. */
export async function DELETE() {
  try {
    const user = await requireUser();
    const existing = await getMtAccount(user.id);
    if (!existing) {
      return NextResponse.json({ ok: true });
    }

    clearRpcCache(user.id);
    if (existing.metaapi_account_id && existing.metaapi_account_id !== "mt5local") {
      try {
        await removeMetaApiAccount(existing.metaapi_account_id);
      } catch {
        /* account may already be gone on MetaApi side */
      }
    }
    await deleteMtAccount(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
