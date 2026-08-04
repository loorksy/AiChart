import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "node:test";
import {
  LANDING_CTA_HREFS,
  LANDING_ROUTES,
  getLandingCopy,
} from "../landingCopy";

const root = resolve(process.cwd(), "src");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("landing redesign", () => {
  test("page redirects authenticated users and exports metadata", () => {
    const page = read("app/page.tsx");
    assert.match(page, /redirect\("\/workspace"\)/);
    assert.match(page, /awaiting-approval/);
    assert.match(page, /export const metadata/);
    assert.match(page, /openGraph/);
    assert.match(page, /LandingPage/);
  });

  test("canonical structure mounts redesigned sections without candlestick backdrop", () => {
    const page = read("components/landing/LandingPage.tsx");
    assert.match(page, /LandingHero/);
    assert.match(page, /LandingPartners/);
    assert.match(page, /LandingBenefits/);
    assert.match(page, /LandingHowItWorks/);
    assert.match(page, /LandingStats/);
    assert.match(page, /LandingWorkspace/);
    assert.match(page, /LandingTrust/);
    assert.match(page, /LandingTestimonials/);
    assert.match(page, /LandingPricing/);
    assert.match(page, /LandingHistory/);
    assert.match(page, /LandingFaq/);
    assert.match(page, /LandingCta/);
    assert.doesNotMatch(page, /ChartBackground|LandingFeatures|LandingAccess|LandingPerformance|LandingSecurity/);
  });

  test("exactly three primary benefits and three how-it-works steps", () => {
    const ar = getLandingCopy("ar");
    const en = getLandingCopy("en");
    assert.equal(ar.benefits.items.length, 3);
    assert.equal(en.benefits.items.length, 3);
    assert.equal(ar.how.steps.length, 3);
    assert.equal(en.how.steps.length, 3);
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
      "components/landing/LandingBenefits.tsx",
      "components/landing/LandingNav.tsx",
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
    }
  });

  test("header exposes theme, locale, opaque mobile modal portal, and real CTAs", () => {
    const nav = read("components/landing/LandingNav.tsx");
    assert.match(nav, /landing-theme-toggle/);
    assert.match(nav, /landing-locale-toggle/);
    assert.match(nav, /landing-mobile-drawer/);
    assert.match(nav, /landing-menu-trigger/);
    assert.match(nav, /createPortal/);
    assert.match(nav, /animate-landing-modal/);
    assert.match(nav, /backgroundColor: "var\(--background\)"/);
    assert.match(nav, /href=\{LANDING_ROUTES\.signup\}/);
    assert.match(nav, /href=\{LANDING_ROUTES\.login\}/);
    assert.match(nav, /Escape/);
  });

  test("product preview is illustrative and avoids TradingView runtime", () => {
    const preview = read("components/landing/ProductPreview.tsx");
    assert.match(preview, /Illustrative|illustrative|توضيحية/);
    assert.doesNotMatch(preview, /charting_library|SmartChartWorkspace|createChart\(/i);
    const copy = read("components/landing/landingCopy.ts");
    assert.match(copy, /Illustrative data|بيانات توضيحية/);
  });

  test("bilingual copy parity for FAQ and hero", () => {
    const ar = getLandingCopy("ar");
    const en = getLandingCopy("en");
    assert.equal(ar.faq.items.length, en.faq.items.length);
    assert.ok(ar.hero.title.length > 8);
    assert.ok(en.hero.title.length > 8);
    assert.notEqual(ar.hero.title, en.hero.title);
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

  test("public legal pages share redesigned header/footer without chart backdrop", () => {
    const pub = read("app/p/[slug]/PublicPageClient.tsx");
    assert.match(pub, /LandingNav/);
    assert.match(pub, /LandingFooter/);
    assert.doesNotMatch(pub, /ChartBackground/);
  });

  test("brand mark assets keep the unclipped viewBox", () => {
    const logo = read("components/AiChartLogo.tsx");
    assert.match(logo, /aichart-mark\.svg|aichart-mark-light\.svg/);
    assert.match(logo, /object-contain/);
    const mark = readFileSync(
      resolve(process.cwd(), "public/brand/aichart-mark.svg"),
      "utf8",
    );
    assert.match(mark, /viewBox=["']0 350 3000 2250["']/);
  });
});
