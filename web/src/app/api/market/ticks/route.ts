import { NextRequest } from "next/server";
import { handleError, requirePlatformAccess } from "@/lib/api";
import { getMtAccount } from "@/lib/store";
import { resolveMarketDataSource } from "@/lib/markets/marketDataSource";
import { subscribeSymbolTicks } from "@/lib/metaapi/streaming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-Sent Events of live bid/ask for a linked cloud account.
 *
 * One MetaApi quote subscription per open chart symbol per user. Closing the
 * EventSource (chart unmount, tab backgrounded) tears the listener down; when
 * the last client for a symbol leaves, the market-data subscription is cancelled.
 * Platform-feed charts get 204 — the datafeed keeps its poll fallback.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const symbol = (req.nextUrl.searchParams.get("symbol") ?? "")
      .trim()
      .replace(/[^A-Za-z0-9._]/g, "");
    if (!symbol) {
      return new Response(JSON.stringify({ error: "symbol required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const decision = await resolveMarketDataSource(user.id, null);
    if (decision.source !== "metaapi") {
      return new Response(null, { status: 204 });
    }

    const account = await getMtAccount(user.id);
    const accountId = account?.metaapi_account_id;
    if (!accountId || accountId === "mt5local") {
      return new Response(null, { status: 204 });
    }

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let closed = false;

    const stream = new ReadableStream({
      start(controller) {
        const send = (payload: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
            );
          } catch {
            closed = true;
          }
        };

        send({ type: "ready", symbol, source: "metaapi" });

        void subscribeSymbolTicks({
          userId: user.id,
          metaapiAccountId: accountId,
          symbol,
          onTick: (tick) => send({ type: "tick", ...tick }),
        })
          .then((unsub) => {
            unsubscribe = unsub;
            if (closed) unsub();
          })
          .catch((err) => {
            send({
              type: "error",
              message: err instanceof Error ? err.message : "stream failed",
            });
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          });

        const heartbeat = setInterval(() => {
          if (closed) {
            clearInterval(heartbeat);
            return;
          }
          try {
            controller.enqueue(encoder.encode(`: ping\n\n`));
          } catch {
            clearInterval(heartbeat);
          }
        }, 15_000);

        const onAbort = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          unsubscribe?.();
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        };
        req.signal.addEventListener("abort", onAbort);
      },
      cancel() {
        closed = true;
        unsubscribe?.();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
