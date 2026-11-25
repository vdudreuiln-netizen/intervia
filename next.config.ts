import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // rendu PDF côté serveur (Node), sans passer par le bundler
  serverExternalPackages: ["@react-pdf/renderer"],
  // formulaire officiel CERFA 15497*04 lu sur le disque par la route de la fiche fluides
  outputFileTracingIncludes: { "/app/chantiers/[id]/fluides": ["./src/lib/site/cerfa/*.pdf"] },
  // les imports de tarifs (jusqu'à 5 000 lignes) transitent par une action serveur
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
};

export default nextConfig;
