/**
 * Read-only adapter around the official @binance/binance-cli (Binance Skills
 * Hub execution skill). It gives the agent access to Binance's broad REST
 * surface (spot, futures, earn, wallet…) for FETCHING data only.
 *
 * SAFETY:
 * - Disabled unless ENABLE_BINANCE_CLI=1.
 * - Hard allow-list of command groups + deny-list of any mutating keyword.
 * - Order execution NEVER goes through here — it stays on the Risk Guard path.
 * - The "profile" command (key management) and custom write requests are blocked.
 */
import { execFile } from "child_process";
import path from "path";
import { getBinanceCredentials } from "./store";
import { getPlatformValue } from "./platformConfig";

export function isBinanceCliEnabled(): boolean {
  return getPlatformValue("ENABLE_BINANCE_CLI") === "1";
}

// Command groups the agent may read from.
const READ_GROUPS = new Set([
  "spot",
  "futures-usds",
  "futures-coin",
  "margin-trading",
  "wallet",
  "simple-earn",
  "staking",
  "crypto-loan",
  "convert",
]);

// Any argument matching these (case-insensitive) is rejected outright.
const DENY = new RegExp(
  [
    "order",
    "withdraw",
    "transfer",
    "cancel",
    "redeem",
    "subscribe",
    "borrow",
    "repay",
    "place",
    "create",
    "new",
    "post",
    "put",
    "delete",
    "profile",
    "key",
    "secret",
    "enable",
    "disable",
    "accept",
    "convert-trade",
    "apply",
    "close",
  ].join("|"),
  "i",
);

export interface CliResult {
  ok: boolean;
  output: string;
}

/** Validates and runs a read-only binance-cli command for a user. */
export function runBinanceCli(
  userId: number,
  args: string[],
): Promise<CliResult> {
  return new Promise((resolve) => {
    if (!isBinanceCliEnabled()) {
      resolve({ ok: false, output: "أداة binance-cli غير مُفعّلة على الخادم." });
      return;
    }
    if (!Array.isArray(args) || args.length === 0) {
      resolve({ ok: false, output: "أمر فارغ." });
      return;
    }
    const group = args[0];
    if (!READ_GROUPS.has(group)) {
      resolve({ ok: false, output: `مجموعة غير مسموحة: ${group}` });
      return;
    }
    // Reject any mutating/dangerous token anywhere in the args.
    if (args.some((a) => DENY.test(a))) {
      resolve({
        ok: false,
        output: "رُفض: الأمر يحتوي عملية غير مسموحة (قراءة فقط).",
      });
      return;
    }

    const creds = getBinanceCredentials(userId);
    if (!creds) {
      resolve({ ok: false, output: "لا يوجد حساب Binance مرتبط." });
      return;
    }

    const bin = path.join(
      process.cwd(),
      "node_modules",
      ".bin",
      "binance-cli",
    );
    execFile(
      bin,
      args,
      {
        timeout: 15000,
        env: {
          ...process.env,
          BINANCE_API_KEY: creds.apiKey,
          BINANCE_SECRET_KEY: creds.apiSecret,
          BINANCE_API_ENV: creds.env,
        },
      },
      (err, stdout, stderr) => {
        const output = (stdout || "") + (stderr || "");
        resolve({
          ok: !err,
          output: output.slice(0, 4000) || (err ? String(err.message) : ""),
        });
      },
    );
  });
}
