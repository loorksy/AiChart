import type { MetadataRoute } from "next";
import { BRAND_URL } from "@/lib/brand";
import { PRIVATE_PATH_PREFIXES } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  const disallow = [...PRIVATE_PATH_PREFIXES];
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow,
      },
      {
        userAgent: [
          "GPTBot",
          "ChatGPT-User",
          "ClaudeBot",
          "anthropic-ai",
          "PerplexityBot",
          "Google-Extended",
          "Applebot-Extended",
          "CCBot",
        ],
        allow: ["/", "/privacy", "/pricing", "/login", "/signup", "/llms.txt"],
        disallow,
      },
    ],
    sitemap: new URL("sitemap.xml", BRAND_URL).toString(),
    host: new URL(BRAND_URL).host,
  };
}
