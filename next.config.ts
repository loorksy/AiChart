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
  async rewrites() {
    return {
      // The admin console is a separate Flutter application whose built
      // bundle is published into public/admin-app/ (infra/build-admin-app.sh).
      // Next serves the files inside that folder, but a folder has no index
      // route of its own: /admin-app/ 308s to /admin-app and 404s, which is
      // the exact URL an operator types. This rewrite is what makes the
      // console answer. Assets are unaffected — they resolve through the
      // bundle's own <base href="/admin-app/">.
      beforeFiles: [
        { source: "/admin-app", destination: "/admin-app/index.html" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: "/embed/chart",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors *",
          },
        ],
      },
    ];
  },
  // better-sqlite3 is a native module and must not be bundled by Next.
  serverExternalPackages: ["better-sqlite3", "pg"],
  // Vendored OpenAI realtime-voice-component ships TypeScript source.
  transpilePackages: ["realtime-voice-component", "metal-fx", "@paper-design/shaders"],
  turbopack: {
    resolveAlias: {
      klinecharts: "./src/lib/chart/klinechartsShim.ts",
    },
  },
};

export default nextConfig;
