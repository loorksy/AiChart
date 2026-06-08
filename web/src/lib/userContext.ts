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

export async function buildUserContext(userId: number): Promise<string> {
  const user = await getPublicUser(userId);
  if (!user) return "";

  const settings = await getSettings(userId);
  const binance = await getBinanceAccountMeta(userId);
  const trades = await listTrades(userId, 5);
  const intents = await listIntents(userId, "pending", 5);
  const recs = await listRecommendations(userId, 3);
  const openTrades = await countOpenTrades(userId);
  const totalTrades = (await listTrades(userId, 200)).length;

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
