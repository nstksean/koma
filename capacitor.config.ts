import type { CapacitorConfig } from "@capacitor/cli";

// Koma 走「Capacitor 殼包現有 Next.js web」模型(見 docs/meta/plans/mvp-stage0-plan.md §8.5 與
// 04-stage3-tts-pipeline.md §0):iOS app 直接載入「部署好的 web」(server.url),只把「音訊播放」
// 委派給 @capgo/capacitor-native-audio 的原生 AVPlayer(背景播放 / 鎖屏控制 / 變速 / seek)。
// web UI、SourceAdapter、Drizzle、TTS API、逐字高亮全部帶得走、不重寫。
//
// server.url 由 KOMA_NATIVE_URL 提供,於 `cap sync` 時讀取:
//   - 上線:production web URL(例 https://koma.app)
//   - 真機 dev:Tailscale TLS dev URL(https://...ts.net) —— 須 TLS,WKWebView 不收 cleartext
// 未設則留空 → 退回打包的 webDir(public),僅作離線 fallback。
// ponytail: env 注入而非寫死 URL,免得 prod/dev 各自 fork 一份 config。
const nativeUrl = process.env.KOMA_NATIVE_URL;

const config: CapacitorConfig = {
  appId: "ai.iqt.koma", // reverse-DNS bundle id;送審前可改
  appName: "Koma",
  webDir: "public", // server.url 模式下僅 fallback;cap 仍要求一個實體目錄
  ...(nativeUrl ? { server: { url: nativeUrl } } : {}),
  ios: {
    // 背景音訊由 native-audio plugin 接管(AVAudioSession .playback)。
    // ⚠️ cap add ios 後,須在 ios/App/App/Info.plist 補 UIBackgroundModes: ["audio"],
    //    否則 app 切背景會被 suspend(見 spike-native-plugin.md §1)。
    contentInset: "automatic",
  },
};

export default config;
