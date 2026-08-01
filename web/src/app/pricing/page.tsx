import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { initDb } from "@/lib/db";
import { getStripeKeys } from "@/lib/billing/stripe";
import { TIER_ORDER, TIERS } from "@/lib/billing/tiers";
import { PricingCards } from "@/components/billing/PricingCards";
import { SkipLink, Surface } from "@/components/foundation";
import { AiChartLogo } from "@/components/AiChartLogo";
import { BRAND_NAME } from "@/lib/brand";

export const metadata = {
  title: `الباقات والأسعار — ${BRAND_NAME}`,
  description:
    "أربع باقات شهرية برصيد استخدام مضمّن: تحليل ذكي، ربط MT5، تنفيذ حي، ووكيل صوتي.",
};

/**
 * V2-A5 (#94): the public pricing page. Tier data comes from the same
 * tiers.ts the enforcement gate reads — the page can never drift from what
 * the billing actually does. Checkout works when Stripe keys exist;
 * otherwise the CTA degrades to "contact us".
 */
export default async function PricingPage() {
  await initDb();
  const [user, stripeKeys] = await Promise.all([getCurrentUser(), getStripeKeys()]);
  const tiers = TIER_ORDER.map((id) => TIERS[id]);

  return (
    <div dir="rtl" className="min-h-dvh bg-background">
      <SkipLink targetId="pricing-main">تخطَّ إلى المحتوى</SkipLink>

      <header className="flex min-h-14 items-center justify-between border-b border-border/60 bg-card/80 px-4 backdrop-blur-md sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <AiChartLogo size={22} showName />
        </Link>
        <div className="flex items-center gap-2">
          {user ? (
            <Link
              href="/console/billing"
              className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              الفوترة والرصيد
            </Link>
          ) : (
            <Link
              href="/signup"
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              إنشاء حساب
            </Link>
          )}
        </div>
      </header>

      <main id="pricing-main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-12 sm:px-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground sm:text-4xl">
            باقة واحدة، كل القوة
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
            كل باقة تمنحك رصيد استخدام شهرياً يُستهلك حسب استخدامك الفعلي —
            تحليلات أعمق ومودلات أقوى تستهلك أكثر. نفد الرصيد؟ اشحن متى شئت
            ورصيد الشحن لا تنتهي صلاحيته.
          </p>
        </div>

        <PricingCards
          tiers={tiers.map((t) => ({
            id: t.id,
            nameEn: t.nameEn,
            nameAr: t.nameAr,
            priceUsd: t.priceUsd,
            includedCreditsUsd: t.includedCreditsUsd,
            features: t.features,
            modelCount: t.allowedModels.length || 8,
          }))}
          signedIn={user != null}
          stripeReady={stripeKeys != null}
        />

        <section className="mx-auto mt-16 max-w-3xl space-y-6">
          <h2 className="text-center text-xl font-semibold text-foreground">
            أسئلة شائعة
          </h2>
          {[
            {
              q: "كيف يعمل رصيد الاستخدام؟",
              a: "كل تحليل أو محادثة أو اتصال MT5 يُخصم من رصيدك حسب الاستهلاك الفعلي (بحسب المودل وعدد التوكنات وساعات الاتصال). ترى كشفاً مفصلاً لكل عملية في صفحة الفوترة.",
            },
            {
              q: "ماذا يحدث عند نفاد الرصيد؟",
              a: "يتوقف التحليل الجديد فقط — تصفح المنصة وتوصياتك السابقة تبقى متاحة دائماً. اشحن رصيداً إضافياً (20$ / 50$ / 100$) أو انتظر تجديد باقتك الشهري.",
            },
            {
              q: "هل يترحّل الرصيد الشهري غير المستخدم؟",
              a: "الرصيد الشهري المضمّن في الباقة يتجدد كاملاً كل شهر ولا يترحّل. رصيد الشحن الإضافي لا تنتهي صلاحيته أبداً.",
            },
            {
              q: "هل يمكنني الإلغاء في أي وقت؟",
              a: "نعم — الاشتراك شهري بلا التزام، وتديره بالكامل من بوابة الفوترة.",
            },
          ].map((item) => (
            <Surface key={item.q} as="article" padding="lg">
              <h3 className="font-semibold text-foreground">{item.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
            </Surface>
          ))}
        </section>
      </main>
    </div>
  );
}
