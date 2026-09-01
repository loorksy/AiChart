import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "node:test";
import {
  LANDING_CTA_HREFS,
  LANDING_ROUTES,
  getLandingCopy,
} from "../landingCopy";
import {
  ANTHROPIC_MODEL_CHOICES,
  PLATFORM_DEFAULT_MODEL_ID,
  shortModelLabel,
} from "@/lib/modelCatalog";
import { ar } from "@/lib/i18n/ar";
import { en } from "@/lib/i18n/en";

const root = resolve(process.cwd(), "src");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const DEFAULT_MODEL_LABEL = shortModelLabel(
  ANTHROPIC_MODEL_CHOICES.find((m) => m.id === PLATFORM_DEFAULT_MODEL_ID)?.label ??
    "",
);

describe("landing redesign", () => {
  test("page redirects authenticated users and exports metadata", () => {
    const page = read("app/page.tsx");
    assert.match(page, /redirect\("\/chat"\)/);
    assert.match(page, /awaiting-approval/);
    assert.match(page, /export const metadata/);
    assert.match(page, /pageMetadata\("home"\)/);
    assert.match(page, /LandingPage/);
    assert.doesNotMatch(page, /MetaTrader execution|Execute with clarity/);
  });

  test("canonical structure is one viewport — no marketing scroll below the fold", () => {
    const page = read("components/landing/LandingPage.tsx");
    assert.match(page, /LandingHero/);
    assert.match(page, /PublicChrome/);
    assert.match(page, /lockViewport/);
    assert.match(page, /faqJsonLd/);
    assert.doesNotMatch(
      page,
      /LandingBenefits|LandingHowItWorks|LandingStats|LandingWorkspace|LandingTrust|LandingTestimonials|LandingPricing|LandingHistory|LandingFaq|LandingCta|LandingFooter/,
    );
    assert.doesNotMatch(
      page,
      /ChartBackground|LandingFeatures|LandingAccess|LandingPerformance|LandingSecurity/,
    );
  });

  test("no-scroll is enforced with a viewport-locked container", () => {
    const page = read("components/landing/LandingPage.tsx");
    const chrome = read("components/landing/PublicChrome.tsx");
    const css = read("app/globals.css");
    assert.match(page, /lockViewport/);
    assert.match(chrome, /landing-viewport/);
    assert.match(css, /\.landing-viewport\s*\{/);
    assert.match(css, /height:\s*100dvh/);
    assert.match(css, /overflow:\s*hidden/);
    assert.doesNotMatch(page, /min-h-dvh/);
    const hero = read("components/landing/LandingHero.tsx");
    assert.match(hero, /html\.style\.overflow = "hidden"/);
    assert.match(hero, /body\.style\.overflow = "hidden"/);
  });

  test("exactly three primary benefits and three how-it-works steps", () => {
    const arCopy = getLandingCopy("ar");
    const enCopy = getLandingCopy("en");
    assert.equal(arCopy.benefits.items.length, 3);
    assert.equal(enCopy.benefits.items.length, 3);
    assert.equal(arCopy.how.steps.length, 3);
    assert.equal(enCopy.how.steps.length, 3);
  });

  test("CTA routes are real and have matching app pages or dynamic pages", () => {
    for (const href of Object.values(LANDING_ROUTES)) {
      if (href === "/") {
        assert.ok(existsSync(resolve(root, "app/page.tsx")));
        continue;
      }
      if (href.startsWith("/p/")) {
        assert.ok(existsSync(resolve(root, "app/p/[slug]/page.tsx")), href);
        continue;
      }
      const file = resolve(root, `app${href}/page.tsx`);
      assert.ok(existsSync(file), `missing page for ${href}`);
    }
    for (const href of LANDING_CTA_HREFS) {
      if (href.startsWith("#")) continue;
      assert.ok(
        Object.values(LANDING_ROUTES).includes(href as (typeof LANDING_ROUTES)[keyof typeof LANDING_ROUTES]),
        href,
      );
    }
  });

  test("no fake statistics, testimonials, or purple/neon marketing classes", () => {
    const files = [
      "components/landing/LandingPage.tsx",
      "components/landing/LandingHero.tsx",
      "components/landing/LandingComposer.tsx",
      "components/landing/HorizonBackground.tsx",
      "components/landing/LandingNav.tsx",
      "components/landing/PublicChrome.tsx",
      "components/landing/landingCopy.ts",
      "components/landing/ProductPreview.tsx",
      "components/landing/LandingTestimonials.tsx",
    ];
    for (const file of files) {
      const src = read(file);
      assert.doesNotMatch(src, /#7c3aed|#8b5cf6|#a855f7|purple-|from-violet|to-indigo|neon|glow-/i);
      assert.doesNotMatch(src, /win rate|always profitable|999%|\$1,000,000/i);
      assert.doesNotMatch(src, /\bguaranteed returns?\b|\bguaranteed accuracy\b|\brisk-free trading\b/i);
      assert.doesNotMatch(src, /Skill Registry|Run Trace|Research Swarm|Shadow Trader|Trading DNA/i);
      assert.doesNotMatch(src, /Horizon 1\.0 Max|Musk tweets|TSLA|SPY|Congress/i);
    }
  });

  test("the landing never sells the deleted execution product", () => {
    const copy = read("components/landing/landingCopy.ts");
    const tiers = read("lib/billing/tiers.ts");
    for (const src of [copy, tiers]) {
      assert.doesNotMatch(src, /MetaTrader execution|MetaApi|Approval-first execution/i);
      assert.doesNotMatch(src, /mt5Link|liveExecution/, "the execution feature flags are gone");
      assert.doesNotMatch(src, /تنفيذ MetaTrader|تنفيذ الصفقات الحي|ربط حساب MT5|وافق على التنفيذ/);
      assert.doesNotMatch(src, /Live trade execution|Approve execution|MT5 account link/);
      assert.doesNotMatch(src, /Available after connection|متاح بعد الربط/);
    }
    assert.match(copy, /هل أحتاج حساب وساطة أو MetaTrader؟/);
  });

  test("header exposes a full-viewport overlay and real CTAs — no theme or language", () => {
    const nav = read("components/landing/LandingNav.tsx");
    assert.match(nav, /landing-brand/);
    assert.match(nav, /landing-mobile-drawer/);
    assert.match(nav, /landing-menu-trigger/);
    assert.match(nav, /createPortal/);
    assert.match(nav, /fixed inset-0/);
    assert.match(nav, /group-aria-expanded/);
    assert.match(nav, /cubic-bezier\(\.5,\.85,\.25,1\.1\)/);
    assert.match(nav, /LANDING_ROUTES\.signup/);
    assert.match(nav, /href=\{LANDING_ROUTES\.login\}/);
    assert.match(nav, /LANDING_ROUTES\.pricing/);
    assert.match(nav, /LANDING_ROUTES\.console/);
    assert.match(nav, /LANDING_ROUTES\.recommendations/);
    assert.match(nav, /LANDING_ROUTES\.performance/);
    assert.match(nav, /LANDING_ROUTES\.privacy/);
    assert.match(nav, /landing\.nav\.section\.account/);
    assert.match(nav, /landing\.nav\.section\.navigation/);
    assert.match(nav, /landing\.nav\.section\.resources/);
    assert.match(nav, /registrationOpen\s*\?/);
    assert.match(nav, /Escape/);
    assert.doesNotMatch(nav, /#features|#how|#stats|#faq/);
    assert.doesNotMatch(nav, /max-w-sm/);
    assert.doesNotMatch(nav, /animate-landing-modal/);
    assert.doesNotMatch(nav, /ThemeToggle|LanguageSwitcher/);
    assert.doesNotMatch(nav, /landing-theme-toggle|landing-locale-toggle/);
    assert.doesNotMatch(nav, /variant\s*=\s*"compact"|compactDesktopNav/);
  });

  test("logo is always visible and the menu trigger is a bare icon", () => {
    const nav = read("components/landing/LandingNav.tsx");
    assert.match(nav, /data-testid="landing-brand"/);
    assert.match(nav, /<AiChartLogo/);
    assert.doesNotMatch(nav, /open \? brand/);
    assert.match(nav, /<button\s+type="button"/);
    assert.match(nav, /bg-transparent/);
    assert.match(nav, /hover:bg-transparent/);
    assert.doesNotMatch(nav, /import \{ Button/);
    const start = nav.indexOf("landing-menu-trigger");
    const triggerBlock = nav.slice(start, start + 700);
    assert.doesNotMatch(triggerBlock, /border-white|border-border|rounded-md|rounded-lg|bg-muted|bg-white\/10/);
  });

  test("product preview is illustrative and avoids TradingView runtime", () => {
    const preview = read("components/landing/ProductPreview.tsx");
    assert.match(preview, /Illustrative|illustrative|توضيحية/);
    assert.doesNotMatch(preview, /charting_library|SmartChartWorkspace|createChart\(/i);
    const copy = read("components/landing/landingCopy.ts");
    assert.match(copy, /Illustrative data|بيانات توضيحية/);
  });

  test("bilingual copy parity for FAQ and hero", () => {
    const arCopy = getLandingCopy("ar");
    const enCopy = getLandingCopy("en");
    assert.equal(arCopy.faq.items.length, enCopy.faq.items.length);
    assert.ok(arCopy.hero.title.length > 8);
    assert.ok(enCopy.hero.title.length > 8);
    assert.notEqual(arCopy.hero.title, enCopy.hero.title);
  });

  test("landing i18n ar/en parity for the one-screen surface", () => {
    const keys = [
      "landing.hero.line1",
      "landing.hero.line2",
      "landing.composer.placeholder",
      "landing.composer.submit",
      "landing.pill.gold",
      "landing.pill.recommend",
      "landing.pill.telegram",
      "landing.pill.performance",
      "landing.nav.login",
      "landing.nav.signup",
      "landing.nav.pricing",
      "landing.nav.chat",
      "landing.nav.home",
      "landing.nav.privacy",
      "landing.nav.section.account",
      "landing.nav.section.navigation",
      "landing.nav.section.resources",
    ] as const;
    for (const key of keys) {
      assert.ok(en[key].length > 1, key);
      assert.ok(ar[key].length > 1, key);
      assert.notEqual(ar[key], en[key], key);
    }
    assert.match(ar["landing.hero.line1"], /ذكاء للذهب/);
    assert.match(ar["landing.hero.line2"], /توصية/);
    assert.match(en["landing.hero.line1"], /Intelligence for gold/);
    assert.match(en["landing.hero.line2"], /recommendation/i);
    assert.doesNotMatch(ar["landing.hero.line1"], /اكتب جملة/);
    assert.doesNotMatch(en["landing.hero.line1"], /Type a sentence/);
    assert.match(ar["landing.nav.signup"], /احصل على وصول/);
    assert.match(en["landing.nav.signup"], /Get access/);
    assert.match(ar["landing.composer.placeholder"], /ما فكرتك/);
    assert.match(en["landing.composer.placeholder"], /What's your idea/);
  });

  test("composer uses the real catalog model and continues through /chat", () => {
    const composer = read("components/landing/LandingComposer.tsx");
    assert.match(composer, /PLATFORM_DEFAULT_MODEL_ID|shortModelLabel/);
    assert.match(composer, /LANDING_ROUTES\.console/);
    assert.match(composer, /landing-composer/);
    assert.match(composer, /landing-pill-\$\{pill\.id\}/);
    assert.match(composer, /id: "gold"/);
    assert.doesNotMatch(composer, /Horizon 1\.0 Max|AudioLines|Mic\b/);
    assert.ok(DEFAULT_MODEL_LABEL.length > 0);
    assert.doesNotMatch(DEFAULT_MODEL_LABEL, /Horizon/);
  });

  test("registration-closed does not crash landing and hides signup", () => {
    const chrome = read("components/landing/PublicChrome.tsx");
    const nav = read("components/landing/LandingNav.tsx");
    assert.match(chrome, /isRegistrationOpen/);
    assert.match(chrome, /registrationOpen = false/);
    assert.match(chrome, /catch/);
    assert.match(nav, /registrationOpen/);
    assert.match(nav, /registrationOpen\s*\?/);
  });

  test("legal disclaimer remains accessible in footer", () => {
    const footer = read("components/landing/LandingFooter.tsx");
    assert.match(footer, /LANDING_ROUTES\.risk/);
    assert.match(footer, /LANDING_ROUTES\.privacy/);
    assert.match(footer, /disclaimer/);
    assert.doesNotMatch(footer, /discord\.gg|reddit\.com/);
  });

  test("legacy Arabic-only landingContent and oversized feature grid are gone", () => {
    assert.ok(!existsSync(resolve(root, "components/landing/landingContent.ts")));
    assert.ok(!existsSync(resolve(root, "components/landing/LandingFeatures.tsx")));
    assert.ok(!existsSync(resolve(root, "components/landing/LandingAccess.tsx")));
  });

  test("brand mark assets keep the unclipped viewBox and LONORA wordmark", () => {
    const logo = read("components/AiChartLogo.tsx");
    assert.match(logo, /aichart-mark\.svg|aichart-mark-light\.svg/);
    assert.match(logo, /object-contain/);
    assert.match(logo, /BRAND_WORDMARK/);
    assert.match(logo, /uppercase/);
    const mark = readFileSync(
      resolve(process.cwd(), "public/brand/aichart-mark.svg"),
      "utf8",
    );
    assert.match(mark, /viewBox=["']0 350 3000 2250["']/);
    const brand = read("lib/brand.ts");
    assert.match(brand, /BRAND_WORDMARK = "LONORA"/);
  });
});
