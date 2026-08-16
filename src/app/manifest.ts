import type { MetadataRoute } from "next";
import { webManifest } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return webManifest();
}
