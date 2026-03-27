import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,

  experimental: {
    serverComponentsExternalPackages: ["@sparticuz/chromium"],
  },

  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;

// trigger redeploy