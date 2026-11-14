import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // les imports de tarifs (jusqu'à 5 000 lignes) transitent par une action serveur
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
};

export default nextConfig;
