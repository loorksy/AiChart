import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Third-party vendored typings (gitignored; present on machines that have
    // pulled the licensed TradingView library) — not our code to lint.
    "src/vendor/**",
    // Local file dependencies are versioned in this repository but own their
    // lint lifecycle. The application consumes their public package surface.
    "vendor/**",
    // Licensed TradingView runtime bundles (gitignored; provisioned into
    // public/ at build time on the VPS/CI). Minified vendor JS — never lint it.
    "public/charting_library/**",
  ]),
  {
    // Same scope as eslint-config-next's plugin registration: an unscoped
    // object would also match files (e.g. *.cjs) the react-hooks plugin is
    // not registered for, and ESLint then rejects the whole config.
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    // --- Explicit, intentional lint policy ---------------------------------
    // Correctness rules stay BLOCKING (error): react-hooks/rules-of-hooks,
    // react-hooks/refs (no render-time ref access), react-hooks/immutability
    // (no render-time mutation), react-hooks/exhaustive-deps (warn, upstream),
    // and all TypeScript/Next correctness rules.
    //
    // The following are downgraded to WARNINGS on purpose — this team has NOT
    // adopted the experimental React Compiler rules as a blocking standard, and
    // the `any` usages are intentional boundaries (untyped broker/chart SDKs and
    // test mocks). They stay visible for gradual cleanup without failing CI.
    rules: {
      // Experimental React Compiler rule: flags established hydration/
      // subscription patterns (useSyncExternalStore is used where it matters).
      "react-hooks/set-state-in-effect": "warn",
      // Experimental purity rule: flags time-based animation reads in render.
      "react-hooks/purity": "warn",
      // Intentional `any` at untyped SDK/test boundaries — surfaced, not blocking.
      "@typescript-eslint/no-explicit-any": "warn",
      // Only require const when every destructured binding can be const (mixed
      // destructures with a reassigned member are left as-is).
      "prefer-const": ["error", { destructuring: "all" }],
    },
  },
]);

export default eslintConfig;
