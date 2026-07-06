import {
  getPublicUser,
  getSettings,
  listTrades,
  listIntents,
  listRecommendations,
  countOpenTrades,
} from "./store";
import { DEFAULT_MARKET } from "./marketPolicy";
import { getForexConnectionView } from "./forexConnection";
import { allowedAssetsLabel } from "./allowedAssets";
import { displayNameFromEmail } from "./displayName";

export { displayNameFromEmail };

export async function buildUserContext(userId: number): Promise<string> {
  const user = await getPublicUser(userId);
  if (!user) return "";

  const settings = await getSettings(userId);
  const forex = await getForexConnectionView(userId);
  const trades = await listTrades(userId, 5);
  const intents = await listIntents(userId, "pending", 5);
  const recs = await listRecommendations(userId, 3);
  const openTrades = await countOpenTrades(userId);
  const totalTrades = (await listTrades(userId, 200)).length;

  const name = displayNameFromEmail(user.email);
  const tgLinked = Boolean(settings.telegram_chat_id);
  const activeMarket = settings.active_market ?? DEFAULT_MARKET;

  const mtLine =
    forex.backend === "metaapi"
      ? forex.mt
        ? forex.online
          ? `متصل (${forex.mt.platform} · ${forex.mt.login})`
          : "مربوط — جارٍ الاتصال"
        : "غير مربوط"
      : forex.ea
        ? forex.online
          ? `متصل (${forex.ea.platform})`
          : "مربوط — غير متصل"
        : "غير مربوط";

  const lines = [
    `# سياق المستخدم الحالي (بيانات حقيقية من المنصة)`,
    `- الاسم/المعرّف: ${name} (${user.email})`,
    `- حالة الحساب: ${user.status}`,
    `- السوق النشط: فوركس (MetaTrader)`,
    `- MetaTrader (فوركس${forex.backend === "metaapi" ? " · MetaApi" : " · EA"}): ${mtLine}`,
    `- Telegram: ${tgLinked ? "مرتبط" : "غير مربوط"}`,
    `- وضع التداول: ${
      settings.mode === "auto"
        ? "تنفيذ تلقائي"
        : settings.mode === "direct"
          ? "مباشر (تنفيذ بأمر صريح)"
          : "موافقة يدوية"
    }`,
    `- أسلوب التداول: ${settings.style}`,
    `- الصفقات المنفّذة: ${totalTrades} · المفتوحة: ${openTrades}`,
    `- نوايا بانتظار الموافقة: ${intents.length}`,
    `- الأصول المسموحة (فوركس): ${allowedAssetsLabel(settings.allowed_assets, "forex")}`,
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
