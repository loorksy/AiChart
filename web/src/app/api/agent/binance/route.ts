import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { deleteBinanceAccount, logAudit } from "@/lib/store";

const schema = z.object({
  env: z.enum(["testnet", "prod"]).optional(),
});

/** Bridge: disconnect Binance API keys for the operator account. */
export async function DELETE(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const userId = await resolveAgentUserId();
    const envParam = req.nextUrl.searchParams.get("env");
    let env: "testnet" | "prod" | undefined;
    if (envParam === "testnet" || envParam === "prod") {
      env = envParam;
    } else if (req.headers.get("content-type")?.includes("application/json")) {
      try {
        const body = schema.parse(await req.json());
        env = body.env;
      } catch {
        /* optional body */
      }
    }
    await deleteBinanceAccount(userId, env);
    await logAudit(userId, "agent_binance_disconnect", env ?? "all");
    return NextResponse.json({ ok: true, env: env ?? "all" });
  } catch (err) {
    return handleError(err);
  }
}
