import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { BRAND_DOMAIN, BRAND_NAME, BRAND_URL } from "@/lib/brand";
import { DATA_SYMBOL, DISPLAY_NAME_AR, DISPLAY_NAME_EN } from "@/lib/gold";
import {
  PRIVATE_PATH_PREFIXES,
  SEO_DESCRIPTION_AR,
  SEO_DESCRIPTION_EN,
  SEO_FAQ,
  faqJsonLd,
  llmsTxt,
  pageMetadata,
  privateSurfaceMetadata,
  rootMetadata,
  siteJsonLd,
  webManifest,
} from "@/lib/seo";

const root = resolve(process.cwd());
const src = resolve(root, "src");

const EXECUTION_LIE =
  /MetaTrader execution|execute with clarity|live trade execution|after your approval|يربط MT5|تنفيذ حي|Chat-first Forex/i;

function read(rel: string): string {
  return readFileSync(resolve(src, rel), "utf8");
}

describe("public SEO facts", () => {
  it("names Lonora, the live domain, and gold-only recommendations", () => {
    const blob = [
      SEO_DESCRIPTION_AR,
      SEO_DESCRIPTION_EN,
      llmsTxt(),
      JSON.stringify(siteJsonLd()),
    ].join("\n");
    assert.match(blob, new RegExp(BRAND_NAME));
    assert.match(blob, new RegExp(BRAND_DOMAIN));
    assert.match(blob, new RegExp(DISPLAY_NAME_AR));
    assert.match(blob, new RegExp(DISPLAY_NAME_EN));
    assert.match(blob, new RegExp(DATA_SYMBOL));
    assert.match(blob, /توصيات|recommendations/i);
    assert.match(blob, /شارت|chart/i);
  });

  it("never claims the platform places or brokers a trade", () => {
    const surfaces = [
      read("app/page.tsx"),
      read("app/layout.tsx"),
      read("app/privacy/page.tsx"),
      read("app/pricing/page.tsx"),
      read("app/login/page.tsx"),
      read("app/signup/page.tsx"),
      read("app/robots.ts"),
      read("app/sitemap.ts"),
      read("app/opengraph-image.tsx"),
      readFileSync(resolve(root, "public/site.webmanifest"), "utf8"),
      SEO_DESCRIPTION_AR,
      SEO_DESCRIPTION_EN,
      llmsTxt(),
      JSON.stringify(siteJsonLd()),
      JSON.stringify(faqJsonLd()),
    ];
    for (const text of surfaces) {
      assert.doesNotMatch(text, EXECUTION_LIE);
    }
    assert.match(llmsTxt(), /never places, modifies, or closes a trade/);
    assert.match(JSON.stringify(siteJsonLd()), /Does not place trades/);
  });

  it("imports gold identity instead of re-typing the symbol", () => {
    const seo = read("lib/seo.ts");
    assert.match(seo, /DATA_SYMBOL/);
    assert.match(seo, /DISPLAY_NAME_AR/);
    for (const line of seo.split("\n")) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      assert.doesNotMatch(line, /"XAUUSD"/);
    }
  });

  it("exposes Open Graph, Twitter, canonical, and bilingual alternates", () => {
    const home = pageMetadata("home");
    assert.equal(home.openGraph?.type, "website");
    assert.equal(home.openGraph?.locale, "ar_SA");
    assert.deepEqual(home.openGraph?.alternateLocale, ["en_US"]);
    assert.equal(home.twitter?.card, "summary_large_image");
    assert.equal(home.alternates?.canonical, BRAND_URL);
    const langs = home.alternates?.languages as Record<string, string>;
    assert.equal(langs.ar, BRAND_URL);
    assert.equal(langs.en, BRAND_URL);
    assert.match(String(home.title && typeof home.title === "object" && "absolute" in home.title ? home.title.absolute : home.title), /Lonora/);
  });

  it("keeps signed-in surfaces out of the index", () => {
    const privateMeta = privateSurfaceMetadata("لوحة");
    assert.equal(privateMeta.robots && typeof privateMeta.robots === "object" && "index" in privateMeta.robots && privateMeta.robots.index, false);
    assert.match(read("app/robots.ts"), /PRIVATE_PATH_PREFIXES/);
    for (const path of ["/api/", "/chat", "/workspace", "/settings"]) {
      assert.ok(
        (PRIVATE_PATH_PREFIXES as readonly string[]).includes(path),
        `robots must disallow ${path}`,
      );
    }
    const sitemap = read("app/sitemap.ts");
    assert.match(sitemap, /PUBLIC_PATHS\.home/);
    assert.match(sitemap, /PUBLIC_PATHS\.privacy/);
    assert.doesNotMatch(sitemap, /PUBLIC_PATHS\.llms/);
  });

  it("ships robots, sitemap, llms.txt, and a 1200×630 share image", () => {
    assert.ok(existsSync(resolve(src, "app/robots.ts")));
    assert.ok(existsSync(resolve(src, "app/sitemap.ts")));
    assert.ok(existsSync(resolve(src, "app/llms.txt/route.ts")));
    assert.ok(existsSync(resolve(src, "app/.well-known/llms.txt/route.ts")));
    const og = read("app/opengraph-image.tsx");
    assert.match(og, /width: 1200/);
    assert.match(og, /height: 630/);
    assert.match(read("app/llms.txt/route.ts"), /llmsTxt/);
  });

  it("encodes Organization, WebSite, SoftwareApplication, and honest FAQ", () => {
    const types = JSON.stringify(siteJsonLd());
    assert.match(types, /"Organization"/);
    assert.match(types, /"WebSite"/);
    assert.match(types, /"SoftwareApplication"/);
    assert.match(types, /FinanceApplication/);
    assert.ok(SEO_FAQ.length >= 4);
    for (const item of SEO_FAQ) {
      assert.doesNotMatch(item.a, EXECUTION_LIE);
    }
    assert.match(JSON.stringify(faqJsonLd()), /FAQPage/);
    assert.match(read("components/landing/LandingPage.tsx"), /faqJsonLd/);
    assert.match(read("app/layout.tsx"), /siteJsonLd/);
  });

  it("corrects the web manifest away from the old Forex/console copy", () => {
    const manifest = webManifest();
    assert.equal(manifest.name, BRAND_NAME);
    assert.equal(manifest.start_url, "/");
    assert.doesNotMatch(manifest.description, /Forex scalping|\/console/);
    const staticManifest = readFileSync(resolve(root, "public/site.webmanifest"), "utf8");
    assert.match(staticManifest, /Lonora/);
    assert.doesNotMatch(staticManifest, /AiChart/);
    assert.doesNotMatch(staticManifest, /\/console/);
    const rootMeta = rootMetadata();
    assert.equal(rootMeta.applicationName, BRAND_NAME);
    assert.match(String(rootMeta.openGraph?.url), /aichart\.lork\.cloud/);
  });

  it("wires public pages through the shared SEO module", () => {
    assert.match(read("app/page.tsx"), /pageMetadata\("home"\)/);
    assert.match(read("app/privacy/page.tsx"), /pageMetadata\("privacy"\)/);
    assert.match(read("app/pricing/page.tsx"), /pageMetadata\("pricing"\)/);
    assert.match(read("app/login/page.tsx"), /pageMetadata\("login"\)/);
    assert.match(read("app/signup/page.tsx"), /pageMetadata\("signup"\)/);
    assert.match(read("app/chat/layout.tsx"), /privateSurfaceMetadata/);
    assert.match(read("app/console/layout.tsx"), /privateSurfaceMetadata/);
  });
});
