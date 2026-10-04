import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  // The repo root, not the parent folder that happens to hold another lockfile.
  turbopack: { root: process.cwd() },
};

export default nextConfig;
