import type { NextConfig } from "next";

/**
 * Backend origin for the dev/prod rewrite proxy.
 * Lives outside NEXT_PUBLIC_* so it's never bundled into the client — the
 * browser only ever sees /be/* URLs (same-origin, no CORS).
 */
const HELM_BE_URL =
  process.env.HELM_BE_URL ?? "https://web-production-acacf1.up.railway.app";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/be/:path*",
        destination: `${HELM_BE_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
