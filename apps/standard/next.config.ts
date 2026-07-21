import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  transpilePackages: [
    "@oceanleo/capabilities",
    "@oceanleo/migration-creation",
    "@oceanleo/migration-knowledge",
    "@oceanleo/migration-media",
    "@oceanleo/migration-office",
    "@oceanleo/migration-platform",
    "@oceanleo/plugin-registry",
    "@oceanleo/plugin-runtime",
    "@oceanleo/runtime",
    "@oceanleo/tenant-registry",
    "@oceanleo/ui",
  ],
};

export default nextConfig;
