import type { NextConfig } from "next";

const frameAncestors =
  process.env.ODYSSEUS_FRAME_ORIGINS?.trim() ||
  "http://localhost:8000 http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module and must not be bundled by Next.
  serverExternalPackages: ["better-sqlite3", "pg", "metaapi.cloud-sdk", "playwright"],
  turbopack: {
    resolveAlias: {
      klinecharts: "./src/lib/chart/klinechartsShim.ts",
    },
  },
  async headers() {
    return [
      {
        source: "/integrations/odysseus/embed",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors 'self' ${frameAncestors}`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
