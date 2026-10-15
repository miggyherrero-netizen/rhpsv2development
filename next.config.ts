import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Receipt photos travel inside Server Action bodies (downsized in the browser, capped server-side at ~3.2MB of text).
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  async headers() {
    // Anti-framing ONLY for the backup page and route (an app-wide change needs the owner's decision).
    const noFrame = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ];
    return [
      { source: "/service/settings", headers: noFrame },
      { source: "/api/backup", headers: noFrame },
      {
        source: "/share/service/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
