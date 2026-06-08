// Quick agent smoke test — run from web/: node scripts/test-agent.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Bootstrap Next/tsconfig paths via dynamic import won't work easily.
// Use tsx instead:
console.log("Use: npx tsx scripts/test-agent.ts");
