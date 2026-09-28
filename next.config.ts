import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server is reached at both localhost and 127.0.0.1 (the e2e tests use 127.0.0.1).
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Pin the project root so a stray lockfile in a parent folder is never picked up.
  turbopack: {
    root: __dirname,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
