import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 書籍封面來自來源站，需放行外部圖片網域。
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.ttkan.co" },
      { protocol: "https", hostname: "**.wenku8.com" },
      { protocol: "https", hostname: "img.ttkan.co" },
    ],
  },
};

export default nextConfig;
