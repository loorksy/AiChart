import type { MetadataRoute } from "next";
import { BRAND_URL } from "@/lib/brand";
import { PUBLIC_PATHS } from "@/lib/seo";

const PUBLIC_SITEMAP_PATHS = [
  PUBLIC_PATHS.home,
  PUBLIC_PATHS.privacy,
  PUBLIC_PATHS.pricing,
  PUBLIC_PATHS.login,
  PUBLIC_PATHS.signup,
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_SITEMAP_PATHS.map((path) => ({
    url: path === "/" ? BRAND_URL : new URL(path, BRAND_URL).toString(),
    lastModified,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : 0.6,
  }));
}
