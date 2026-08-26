import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deploys build IN PLACE while `next start` serves the same .next, and every
  // capture failure logged in production clustered inside those build windows
  // (pages launched mid-build against chunks that no longer existed). Setting
  // NEXT_DIST_DIR at build time writes the new build to a staging directory,
  // which the deploy script then swaps in atomically before restarting. At
  // runtime the variable is unset, so `next start` reads the default .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
      // The admin console bundle must never be served stale.
      //
      // Flutter's web output does NOT content-hash its filenames: every build
      // writes the same `main.dart.js`, `flutter_bootstrap.js`, `index.html`
      // and `assets/…`. So there is no version in any URL for a cache to key
      // on, and anything cached by default is a previous build wearing the
      // current build's name — which is how a console three screens out of
      // date kept being shown after a deploy.
      //
      // `no-store` on the entry points: they decide which code runs, and they
      // are a few KB. `no-cache` on the rest ("cache it, but revalidate every
      // time"), so the multi-MB canvaskit payload still comes back as a 304
      // instead of being re-downloaded, while never being used blindly.
      // Order matters: when several entries match one path, the LAST one
      // wins. The broad rule therefore comes first and the entry points
      // override it — written the other way round, the catch-all quietly
      // downgraded them (confirmed against a running server, which is the
      // only way that shows).
      {
        source: "/admin-app/:path*",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
      {
        source: "/admin-app",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
      {
        source:
          "/admin-app/:file(index\\.html|flutter_bootstrap\\.js|main\\.dart\\.js|version\\.json|flutter_service_worker\\.js)",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
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
