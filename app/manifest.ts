import type { MetadataRoute } from "next";

// PWA manifest。iOS 主畫面圖示走 app/apple-icon.png(iOS 不吃 manifest/SVG);
// 這裡的 PNG 給 Android Chrome 安裝用。主題色用 Cat-Eye Dusk 夜底。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Koma — 零廣告小說閱讀器",
    short_name: "Koma",
    description: "乾淨、零廣告、陪伴你閱讀的貓。中文小說閱讀器。",
    start_url: "/",
    display: "standalone",
    background_color: "#151A19",
    theme_color: "#151A19",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // maskable:讓 Android 自適應圖示不被裁掉貓
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
