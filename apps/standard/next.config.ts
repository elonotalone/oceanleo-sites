import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  transpilePackages: [
    "@oceanleo/capabilities",
    "@oceanleo/runtime",
    "@oceanleo/tenant-registry",
    "@oceanleo/ui",
  ],
};

export default nextConfig;
