import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/logo.png",
        destination: "/brand/aichart-mark-dark.png",
        permanent: true,
      },
      {
        source: "/lonora-logo-light.png",
        destination: "/brand/aichart-mark-light.png",
        permanent: true,
      },
      {
        source: "/lonora-logo-dark.png",
        destination: "/brand/aichart-mark-dark.png",
        permanent: true,
      },
      // /console was the trader workspace (chart + chat) route; existing links
      // (including `?chat=<id>` deep links, forwarded automatically since the
      // destination has no conflicting query of its own) keep working.
      {
        source: "/console",
        destination: "/workspace",
        permanent: true,
      },
    ];
  },
  // better-sqlite3 is a native module and must not be bundled by Next.
  serverExternalPackages: ["better-sqlite3", "pg", "metaapi.cloud-sdk", "playwright"],
  // Vendored OpenAI realtime-voice-component ships TypeScript source.
  transpilePackages: ["realtime-voice-component", "metal-fx", "@paper-design/shaders"],
  turbopack: {
    resolveAlias: {
      klinecharts: "./src/lib/chart/klinechartsShim.ts",
    },
  },
};

export default nextConfig;
