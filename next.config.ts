import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "assets.hardcover.app",
        port: "",
        pathname: "/**",
      },
    ],
    maximumRedirects: 0,
  },
};

export default nextConfig;
