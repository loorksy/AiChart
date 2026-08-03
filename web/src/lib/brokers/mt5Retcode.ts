/** MT5 TRADE_RETCODE labels for agent/UI messages (Arabic). */
export const MT5_RETCODE_LEGEND: Record<number, string> = {
  10004: "إعادة التسعير",
  10006: "طلب مرفوض",
  10007: "طلب ملغى",
  10008: "أمر موضوع",
  10009: "تم التنفيذ",
  10010: "تم التنفيذ جزئياً",
  10011: "خطأ في المعالجة",
  10012: "انتهت المهلة",
  10013: "طلب غير صالح",
  10014: "حجم غير صالح",
  10015: "سعر غير صالح",
  10016: "وقف خسارة/جني ربح غير صالح عند الوسيط",
  10017: "التداول معطّل",
  10018: "السوق مغلق",
  10019: "هامش غير كافٍ",
  10020: "لا تغييرات",
  10021: "لا سعر",
  10022: "انتهت صلاحية الأمر",
  10023: "مستوى الأمر مرفوض",
  10024: "عدد الطلبات مرفوض",
  10025: "لا تغيير — الطلب قريب جداً من السوق",
  10026: "سعر/ت quote غير مقبول لحظ الإرسال — تحقق من Market Watch أو وضع Instant Execution",
  10027: "الوسيط مشغول",
  10028: "إعادة الاقتباس فقط",
  10029: "التداول مجمّد على الرمز",
  10030: "نوع التعبئة غير صالح",
};

/** Parses `retcode 10016` from MT5 order error strings. */
export function parseMt5Retcode(error: string): number | null {
  const m = /retcode\s+(\d+)/i.exec(error);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Human-readable Arabic reason for MT5 failures. */
export function formatMt5TradeError(raw: string): string {
  const code = parseMt5Retcode(raw);
  if (code == null) {
    if (/symbol not found/i.test(raw)) {
      return "الرمز غير موجود في MetaTrader — انسخ الاسم من Market Watch حرفياً.";
    }
    if (/off quotes/i.test(raw)) {
      return "لا tick حي لحظ التنفيذ — تأكد أن الرمز في Market Watch ثم أعد المحاولة (ليس بالضرورة إغلاق السوق).";
    }
    return raw;
  }
  const label = MT5_RETCODE_LEGEND[code] ?? "رفض MetaTrader";
  if (code === 10026) {
    return `رفض MetaTrader · retcode 10026 (${label}). إن كانت الأسعار حية (quoteAgeMs منخفض) جرّب صفقة يدوية market على نفس الرمز.`;
  }
  return `رفض MetaTrader · retcode ${code} (${label})`;
}
