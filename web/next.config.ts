import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module and must not be bundled by Next.
  serverExternalPackages: ["better-sqlite3", "pg", "metaapi.cloud-sdk", "playwright"],
  // Vendored OpenAI realtime-voice-component ships TypeScript source.
  transpilePackages: ["realtime-voice-component"],
  turbopack: {
    resolveAlias: {
      klinecharts: "./src/lib/chart/klinechartsShim.ts",
    },
  },
};

export default nextConfig;
