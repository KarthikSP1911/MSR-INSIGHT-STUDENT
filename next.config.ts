import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Short, public link for the resume: opens the dashboard with synthetic demo data.
      { source: "/try", destination: "/student/dashboard?demo=resume", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        // Browsers must always re-fetch the service worker so an update is picked up promptly.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
