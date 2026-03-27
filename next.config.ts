import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@sparticuz/chromium"],
  },

  webpack: (config) => {
    config.externals = [...(config.externals || []), "@sparticuz/chromium"];
    return config;
  },
};

export default nextConfig;

// trigger redeploy