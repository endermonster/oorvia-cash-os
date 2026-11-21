import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // vFulfill CSV uploads on /settings: a full transactions export is ~1 MB and grows. Vercel refuses bodies over 4.5 MB.
    serverActions: { bodySizeLimit: '4.5mb' },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
