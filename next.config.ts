import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Receipt photos travel inside Server Action bodies (downsized in the browser, capped server-side at ~3.2MB of text).
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  async headers() {
    return [{
      source: "/share/service/:path*",
      headers: [
        { key: "Cache-Control", value: "private, no-store, max-age=0" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        { key: "Referrer-Policy", value: "no-referrer" },
      ],
    }];
  },
};

export default nextConfig;
