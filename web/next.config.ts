import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module and must not be bundled by Next.
  serverExternalPackages: ["better-sqlite3", "pg", "metaapi.cloud-sdk", "playwright"],
};

export default nextConfig;
