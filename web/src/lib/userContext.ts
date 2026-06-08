import {
  getPublicUser,
  getSettings,
  getBinanceAccountMeta,
  listTrades,
  listIntents,
  listRecommendations,
  countOpenTrades,
} from "./store";
import { displayNameFromEmail } from "./displayName";

export { displayNameFromEmail };

export function buildUserContext(userId: number): string {
  const user = getPublicUser(userId);
  if (!user) return "";

  const settings = getSettings(userId);
  const binance = getBinanceAccountMeta(userId);
  const trades = listTrades(userId, 5);
  const intents = listIntents(userId, "pending", 5);
  const recs = listRecommendations(userId, 3);
  const openTrades = countOpenTrades(userId);
  const totalTrades = listTrades(userId, 200).length;

  const name = displayNameFromEmail(user.email);
  const tgLinked = Boolean(settings.telegram_chat_id);
  const binanceLinked = Boolean(binance);

  let assets: string[] = [];
  try {
    assets = JSON.parse(settings.allowed_assets) as string[];
  } catch {
    assets = [];
  }

  const lines = [
    `# سياق المستخدم الحالي (بيانات حقيقية من المنصة)`,
    `- الاسم/المعرّف: ${name} (${user.email})`,
    `- حالة الحساب: ${user.status}`,
    `- Binance: ${binanceLinked ? `مرتبط (${binance!.env}${binance!.label ? ` · ${binance!.label}` : ""})` : "غير مربوط"}`,
    `- Telegram: ${tgLinked ? "مرتبط" : "غير مربوط"}`,
    `- وضع التداول: ${settings.mode === "auto" ? "تنفيذ تلقائي" : "توصيات فقط"}`,
    `- أسلوب التداول: ${settings.style}`,
    `- الصفقات المنفّذة: ${totalTrades} · المفتوحة: ${openTrades}`,
    `- نوايا بانتظار الموافقة: ${intents.length}`,
    `- الأصول المسموحة: ${assets.length ? assets.join("، ") : "لم تُحدَّد"}`,
  ];

  if (recs.length) {
    lines.push(
      `- آخر توصيات: ${recs.map((r) => `${r.symbol} ${r.action}`).join(" · ")}`,
    );
  }
  if (trades.length) {
    lines.push(
      `- آخر صفقة: ${trades[0].symbol} ${trades[0].side} (${trades[0].status})`,
    );
  }

  return lines.join("\n");
}
