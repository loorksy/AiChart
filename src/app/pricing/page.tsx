import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { initDb } from "@/lib/db";
import { getStripeKeys } from "@/lib/billing/stripe";
import { getBillingPlan, getCurrentPlanPrice } from "@/lib/billing/planConfig";
import { AICHART_PLAN } from "@/lib/subscription/plan";
import { PricingCards } from "@/components/billing/PricingCards";
import { Surface } from "@/components/foundation";
import {
  PUBLIC_MAIN_PAD,
  PublicChrome,
} from "@/components/landing/PublicChrome";
import { pageMetadata } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const metadata = pageMetadata("pricing");

/**
 * The public pricing page. Plan data comes from the same billing_plan /
 * plan_prices rows the enforcement gate reads — the page can never drift
 * from what billing actually does, and an unset price degrades to the
 * contact CTA. Checkout works when Stripe keys exist.
 *
 * Not gated on FEATURE_BILLING: the billing page's "view plans" action links
 * here, and the gate turned that into a bounce to the landing page.
 */
export default async function PricingPage() {
  await initDb();
  const [user, stripeKeys, plan, price] = await Promise.all([
    getCurrentUser(),
    getStripeKeys(),
    getBillingPlan(),
    getCurrentPlanPrice(),
  ]);

  return (
    <PublicChrome skipTargetId="pricing-main" showFooter>
      <main
        id="pricing-main"
        tabIndex={-1}
        dir="rtl"
        className={cn(PUBLIC_MAIN_PAD, "mx-auto max-w-6xl sm:pb-20")}
      >
        {user ? (
          <div className="mb-6 flex justify-end">
            <Link
              href="/console/billing"
              className="inline-flex min-h-9 items-center rounded-full border border-white/20 px-4 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
              الفوترة والرصيد
            </Link>
          </div>
        ) : null}

        <div className="text-center">
          <h1 className="text-3xl font-bold text-white sm:text-4xl">
            باقة واحدة، كل القوة
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-white/60">
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
          <p className="text-sm text-white/55">
            عندك سؤال قبل الاشتراك؟ تواصل معنا مباشرة.
          </p>
          <a
            href={AICHART_PLAN.telegramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent bg-accent-gold px-6 text-sm font-medium text-black outline-none transition-all hover:bg-accent-gold/80 focus-visible:ring-[3px] focus-visible:ring-accent-gold/50"
          >
            تواصل عبر Telegram
          </a>
        </div>

        <section className="mx-auto mt-16 max-w-3xl space-y-6">
          <h2 className="text-center text-xl font-semibold text-white">
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
            <Surface
              key={item.q}
              as="article"
              padding="lg"
              className="border-white/10 bg-white/5 text-white backdrop-blur-md"
            >
              <h3 className="font-semibold text-white">{item.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/65">{item.a}</p>
            </Surface>
          ))}
        </section>
      </main>
    </PublicChrome>
  );
}
