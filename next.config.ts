import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // rendu PDF côté serveur (Node), sans passer par le bundler
  serverExternalPackages: ["@react-pdf/renderer"],
  // les imports de tarifs (jusqu'à 5 000 lignes) transitent par une action serveur
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
};

export default nextConfig;
