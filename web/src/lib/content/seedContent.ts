import { execute, queryOne } from "@/lib/db";
import { BRAND_NAME } from "@/lib/brand";

/**
 * V2-C (#97): idempotent seeding of docs and first blog posts into
 * dynamic_pages (kind = 'doc' | 'blog'). INSERT-if-missing only — an admin
 * edit is never overwritten. The docs double as the support bot's grounding
 * corpus, so keeping them accurate keeps the bot honest.
 */

interface SeedPage {
  slug: string;
  kind: "doc" | "blog";
  title_ar: string;
  title_en: string;
  content_ar: string;
  content_en: string;
}

export const DOC_SLUGS = [
  "docs-getting-started",
  "docs-smart-chart",
  "docs-recommendations",
  "docs-mt5-linking",
  "docs-billing-credits",
  "docs-support",
] as const;

const PAGES: SeedPage[] = [
  {
    slug: "docs-getting-started",
    kind: "doc",
    title_ar: "البدء مع المنصة",
    title_en: "Getting Started",
    content_ar: `## البدء مع ${BRAND_NAME}\n\n1. أنشئ حسابك بالبريد الإلكتروني أو عبر Google.\n2. عند التسجيل تحصل على رصيد تجريبي مجاني لتجربة التحليل الذكي — بلا بطاقة دفع.\n3. افتح الشارت الذكي من لوحة التحكم واطلب تحليلاً لأي زوج (مثال: «حلل XAUUSD»).\n4. كل توصية تصلك مع صورة الشارت الحية وبطاقة كاملة: الاتجاه، الدخول، الوقف، الأهداف، ومستوى الثقة.\n5. للاستفادة الكاملة اشترك في إحدى الباقات من صفحة الأسعار — كل باقة تمنحك رصيد استخدام شهرياً يُستهلك حسب استخدامك الفعلي.`,
    content_en: `## Getting started with ${BRAND_NAME}\n\n1. Create your account with email or Google.\n2. New accounts receive a free trial credit to try the AI analysis — no card required.\n3. Open the Smart Chart from your console and ask for an analysis of any pair (e.g. "analyze XAUUSD").\n4. Every recommendation arrives with a live chart image and a complete card: direction, entry, stop, targets and confidence.\n5. Subscribe from the pricing page for full access — every tier includes a monthly usage credit that burns with actual usage.`,
  },
  {
    slug: "docs-smart-chart",
    kind: "doc",
    title_ar: "الشارت الذكي والوكيل",
    title_en: "Smart Chart & Agent",
    content_ar: `## الشارت الذكي\n\nالشارت مبني على TradingView مع وكيل ذكاء اصطناعي مدمج.\n\n- **التحليل**: اكتب طلبك في صندوق الدردشة، ويحلل الوكيل عدة فريمات زمنية معاً مع صور حية.\n- **اختيار المودل**: من قائمة صندوق الكتابة تختار المودل (حسب باقتك) — الأقوى أدق وأغلى استهلاكاً للرصيد.\n- **الرسومات**: توصيات الوكيل تُرسم تلقائياً على الشارت (مناطق الدخول، الوقف، الأهداف) وتبقى ثابتة عند تبديل الفريم.\n- **الصوت**: في باقات PRO فما فوق يتوفر وكيل صوتي لحظي يستمع ويرد ويستدعي الأدوات أثناء المحادثة.`,
    content_en: `## Smart Chart\n\nA TradingView-powered chart with an embedded AI agent.\n\n- **Analysis**: type your request in chat; the agent reads multiple timeframes with live images.\n- **Model picker**: choose the model from the composer (per your tier) — stronger models are more accurate and burn more credit.\n- **Drawings**: recommendations are drawn on the chart automatically (entry zones, stop, targets) and persist across timeframe switches.\n- **Voice**: PRO and above include a realtime voice agent that listens, replies and calls tools mid-conversation.`,
  },
  {
    slug: "docs-recommendations",
    kind: "doc",
    title_ar: "التوصيات وتتبع الأداء",
    title_en: "Recommendations & Performance",
    content_ar: `## التوصيات\n\nكل تحليل ناجح ينتهي بتوصية شراء أو بيع مع خطة كاملة: نوعها (فورية / استباقية / مشروطة)، شرط التفعيل، قاعدة الإلغاء، والسيناريو البديل.\n\n- تُتابع المنصة كل توصية آلياً وتُحدّث حالتها (تفعّلت، أصابت الهدف، ضُربت بالوقف، انتهت صلاحيتها).\n- صفحة **الأداء** تجمع كل شيء: التوصيات، الصفقات، الإحصائيات، ونتائج الباك تيست البصرية.\n- الدعم الإحصائي: عندما تطابق التوصية استراتيجية مُختبرة تاريخياً بأكثر من 100 صفقة، يظهر مستوى الثقة المعاير؛ وإلا تُوسم كتحليل مباشر بصدق.`,
    content_en: `## Recommendations\n\nEvery successful analysis ends in a buy or sell with a complete plan: type (immediate / anticipatory / conditional), activation condition, invalidation rule and the alternative scenario.\n\n- The platform tracks every recommendation automatically (activated, target hit, stopped, expired).\n- The **Performance** page gathers everything: recommendations, trades, statistics and visual backtests.\n- Statistical support: when a recommendation matches a strategy validated over 100+ historical trades, calibrated confidence is shown; otherwise it is honestly labeled direct analysis.`,
  },
  {
    slug: "docs-mt5-linking",
    kind: "doc",
    title_ar: "ربط حساب MetaTrader 5",
    title_en: "Linking MetaTrader 5",
    content_ar: `## ربط MT5\n\nمن باقة PLUS فما فوق يمكنك ربط حساب MT5 الحقيقي (من **لوحة التحكم ← ربط MT5**):\n\n1. ابحث عن وسيطك أو أدخل اسم الخادم يدوياً.\n2. سجّل دخولك بحساب MT5 الحقيقي — بياناتك تُخزَّن مشفَّرة AES-256.\n3. عند أول ربط تُسحب سنة كاملة من البيانات التاريخية مرة واحدة، ثم تُخدم من مستودعنا.\n\n**توفير التكلفة تلقائي**: عند مغادرتك المنصة يُوقَف اتصال حسابك خلال 15 دقيقة ويعود وحده عند عودتك — ساعات الاتصال تُخصم من رصيدك بالدقيقة وتظهر في كشف حسابك. حسابات التنفيذ الحي الآلي (PRO فما فوق) تبقى متصلة دائماً.`,
    content_en: `## Linking MT5\n\nFrom PLUS and above you can link your real MT5 account (**Console → Link MT5**):\n\n1. Search for your broker or type the server name manually.\n2. Sign in with your real MT5 credentials — stored AES-256 encrypted.\n3. On first link a full year of history is pulled once, then served from our warehouse.\n\n**Automatic cost saving**: when you leave the platform your account connection pauses within 15 minutes and returns by itself when you're back — connection hours are deducted from your credit by the minute and appear in your statement. Live auto-execution accounts (PRO+) stay connected around the clock.`,
  },
  {
    slug: "docs-billing-credits",
    kind: "doc",
    title_ar: "الباقات والرصيد",
    title_en: "Plans & Credits",
    content_ar: `## كيف تعمل الفوترة\n\n- أربع باقات شهرية: LITE ‏79$، PLUS ‏149$، PRO ‏249$، PRO MAX ‏399$ — كل باقة تمنح رصيد استخدام شهرياً.\n- **الاستهلاك حقيقي**: كل تحليل يُخصم حسب المودل وعدد التوكنات الفعلي؛ ساعات اتصال MT5 تُخصم بالدقيقة.\n- الرصيد الشهري يتجدد كل دورة ولا يترحّل؛ رصيد الشحن الإضافي (20$/50$/100$) لا تنتهي صلاحيته.\n- عند نفاد الرصيد يتوقف التحليل الجديد فقط برسالة واضحة — التصفح وكل بياناتك تبقى متاحة.\n- كشف حركة مفصَّل لكل عملية في **الفوترة والرصيد**، والإلغاء متاح في أي وقت من بوابة الفوترة.`,
    content_en: `## How billing works\n\n- Four monthly tiers: LITE $79, PLUS $149, PRO $249, PRO MAX $399 — each includes a monthly usage credit.\n- **Real metering**: every analysis burns by model and actual tokens; MT5 connection hours burn by the minute.\n- Monthly credit resets each cycle without rollover; top-up credit ($20/$50/$100) never expires.\n- At zero balance only NEW analysis stops, with a clear message — browsing and all your data stay available.\n- A detailed statement lives in **Billing**, and you can cancel anytime from the billing portal.`,
  },
  {
    slug: "docs-support",
    kind: "doc",
    title_ar: "الدعم الفني",
    title_en: "Support",
    content_ar: `## الدعم الفني 24/7\n\n- افتح تذكرة من **لوحة التحكم ← الدعم** في أي وقت.\n- يرد **مساعد ذكي** فوراً اعتماداً على هذا التوثيق — رده يُخصم من رصيدك كأي استخدام.\n- إن لم يكفِ الرد، اطلب التصعيد لمشرف بشري وسيتابع تذكرتك مشرفو الدعم.\n- حالات التذكرة: مفتوحة ← قيد المتابعة ← مغلقة، وتصلك الرسائل الجديدة داخل نفس التذكرة.`,
    content_en: `## Support 24/7\n\n- Open a ticket anytime from **Console → Support**.\n- An **AI assistant** replies instantly, grounded in these docs — its reply burns from your credit like any usage.\n- If that's not enough, request escalation and a human support admin takes over your ticket.\n- Ticket states: open → in progress → closed, with new replies arriving inside the same ticket.`,
  },
  {
    slug: "blog-introducing-v2",
    kind: "blog",
    title_ar: "الإصدار الثاني: منصة تداول ذكية متكاملة",
    title_en: "V2: A Complete AI Trading Platform",
    content_ar: `أطلقنا الإصدار الثاني من ${BRAND_NAME}: باقات اشتراك برصيد استخدام حقيقي، تسجيل دخول عبر Google، ربط MT5 سحابي شفاف مع توفير تكلفة تلقائي، توصيات تصل مع صورة الشارت الحية فور صدورها، ولوحة أدمن بأدوار متعددة. كل استهلاك مُقاس بدقة وكل توصية مُتتبعة بصدق — لا وعود، أرقام.`,
    content_en: `We shipped ${BRAND_NAME} V2: subscription tiers with real usage credits, Google sign-in, transparent cloud MT5 linking with automatic cost saving, recommendations that arrive with their live chart image, and a multi-role admin panel. Every unit of usage is metered and every recommendation is honestly tracked — numbers, not promises.`,
  },
  {
    slug: "blog-how-credits-work",
    kind: "blog",
    title_ar: "لماذا الرصيد حسب الاستخدام أعدل من الحدود الثابتة؟",
    title_en: "Why Usage Credits Beat Fixed Limits",
    content_ar: `الحدود الثابتة («50 تحليلاً شهرياً») تظلم الجميع: المقتصد يدفع عن استهلاك لم يستخدمه، والمكثف يصطدم بجدار مفاجئ. الرصيد حسب الاستخدام يعكس التكلفة الحقيقية: تحليل عميق بمودل قوي يستهلك أكثر من سؤال سريع، وساعة اتصال MT5 تُحسب بالدقيقة. النتيجة: تدفع مقابل ما تستخدمه فعلاً، وترى كل عملية في كشفك.`,
    content_en: `Fixed limits ("50 analyses per month") are unfair to everyone: light users pay for capacity they never use, heavy users hit a sudden wall. Usage credits mirror true cost: a deep analysis on a strong model burns more than a quick question, and an MT5 connection hour is counted by the minute. You pay for what you actually use — and see every movement in your statement.`,
  },
];

let seeded = false;

export async function seedContentPages(): Promise<void> {
  if (seeded) return;
  seeded = true;
  for (const page of PAGES) {
    try {
      const existing = await queryOne(
        "SELECT slug FROM dynamic_pages WHERE slug = ?",
        [page.slug],
      );
      if (existing) {
        // Kind may be missing on rows that predate the column.
        await execute(
          "UPDATE dynamic_pages SET kind = ? WHERE slug = ? AND kind = 'page'",
          [page.kind, page.slug],
        );
        continue;
      }
      await execute(
        `INSERT INTO dynamic_pages (slug, title_ar, title_en, content_ar, content_en, is_published, metadata_json, kind)
         VALUES (?, ?, ?, ?, ?, TRUE, '{}', ?)`,
        [page.slug, page.title_ar, page.title_en, page.content_ar, page.content_en, page.kind],
      );
    } catch {
      /* seeding is best-effort; the CMS remains the source of truth */
    }
  }
}

/** The support bot's grounding corpus: every published doc, Arabic side. */
export async function docsCorpus(): Promise<string> {
  await seedContentPages();
  const { query } = await import("@/lib/db");
  const rows = await query<{ title_ar: string; content_ar: string }>(
    "SELECT title_ar, content_ar FROM dynamic_pages WHERE kind = 'doc' ",
  );
  return rows.map((r) => `# ${r.title_ar}\n${r.content_ar}`).join("\n\n---\n\n");
}
