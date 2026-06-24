import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Azure Speech SDK 走 wss WebSocket 合成，必須留在 node_modules 由 runtime require，
  // 不可被 Next bundle —— 打包後其內部 `ws` 解析會壞，wss 連線以 1006 斷線(聽書整路 500)。
  serverExternalPackages: ["microsoft-cognitiveservices-speech-sdk"],
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
