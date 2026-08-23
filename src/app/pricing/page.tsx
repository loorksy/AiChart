import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { initDb } from "@/lib/db";
import { getStripeKeys } from "@/lib/billing/stripe";
import { getBillingPlan, getCurrentPlanPrice } from "@/lib/billing/planConfig";
import { AICHART_PLAN } from "@/lib/subscription/plan";
import { PricingCards } from "@/components/billing/PricingCards";
import { Surface } from "@/components/foundation";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { BRAND_NAME } from "@/lib/brand";
import { redirect } from "next/navigation";
import { FEATURES } from "@/lib/agent/featureFlags";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("pricing");

/**
 * The public pricing page. Plan data comes from the same billing_plan /
 * plan_prices rows the enforcement gate reads — the page can never drift
 * from what billing actually does, and an unset price degrades to the
 * contact CTA. Checkout works when Stripe keys exist.
 */
export default async function PricingPage() {
  if (!FEATURES.billing()) redirect("/");
  await initDb();
  const [user, stripeKeys, plan, price] = await Promise.all([
    getCurrentUser(),
    getStripeKeys(),
    getBillingPlan(),
    getCurrentPlanPrice(),
  ]);

  return (
    <div dir="rtl" className="min-h-dvh bg-background">
      <LandingNav
        variant="compact"
        skipTargetId="pricing-main"
        actions={
          user ? (
            <Link
              href="/console/billing"
              className="hidden min-h-9 items-center rounded-[var(--radius)] px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
            >
              الفوترة والرصيد
            </Link>
          ) : null
        }
      />

      <main
        id="pricing-main"
        tabIndex={-1}
        className="mx-auto max-w-6xl px-4 py-16 sm:px-8 sm:py-20"
      >
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
          plan={{
            priceCents: price?.price_cents ?? null,
            creditsPerCycle: price?.credits_per_cycle ?? null,
            signupGrantCredits: plan.signup_grant_credits,
          }}
          signedIn={user != null}
          stripeReady={stripeKeys != null}
        />

        {/* CTA row — a live contact path for anything the cards can't answer.
            Same destination the platform already uses for manual activation. */}
        <div className="mx-auto mt-12 flex max-w-xl flex-col items-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">
            عندك سؤال قبل الاشتراك؟ تواصل معنا مباشرة.
          </p>
          {/* Server component — buttonVariants() is client-only, so the xl
              primary button classes are spelled out here (kept in sync with
              squareui/button). */}
          <a
            href={AICHART_PLAN.telegramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent bg-primary px-6 text-sm font-medium text-primary-foreground outline-none transition-all hover:bg-primary/80 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            تواصل عبر Telegram
          </a>
        </div>

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

      <LandingFooter />
    </div>
  );
}
