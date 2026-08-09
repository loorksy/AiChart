import { getPlatformValue } from "./platformConfig";

/** Public HTTPS base URL for links sent to Telegram (never localhost). */
export function getPublicAppUrl(): string {
  const fromConfig =
    getPlatformValue("APP_URL")?.replace(/\/$/, "") ||
    process.env.APP_URL?.replace(/\/$/, "");
  if (fromConfig && !fromConfig.includes("127.0.0.1") && !fromConfig.includes("localhost")) {
    return fromConfig;
  }
  return "https://aichart.lork.cloud";
}
