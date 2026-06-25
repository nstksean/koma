import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 透過 Tailscale serve (TLS 代理) 存取 dev 時,HMR WebSocket 的 Origin 是此網域而非
  // localhost,Next 16 會擋掉跨來源 dev 請求 → wss /_next/webpack-hmr 連不上。
  allowedDevOrigins: ["lmm-seanlin.tail0d933f.ts.net"],
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
