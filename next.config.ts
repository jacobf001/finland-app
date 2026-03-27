import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  serverExternalPackages: ["@sparticuz/chromium"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;