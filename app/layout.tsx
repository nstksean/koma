import type { Metadata } from "next";
import { Fraunces, Noto_Sans_TC, Noto_Serif_TC, Source_Sans_3 } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// Display / 字標(DESIGN:給品牌文學的臉,避開 Inter/Poppins 收斂陷阱)。
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

// 拉丁 UI / 標籤(DESIGN:UI / 標籤 / 拉丁)。
const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source-sans",
  display: "swap",
});

// 閱讀內文 CJK 預設(DESIGN:黑體為主,夜讀辨別度高)。CJK 體積大故不 preload。
const notoSansTC = Noto_Sans_TC({
  weight: ["400", "500", "700"],
  variable: "--font-noto-sans-tc",
  display: "swap",
  preload: false,
});

// 閱讀內文 CJK 可選明體(DESIGN:提供偏好實體書感者,非預設)。
const notoSerifTC = Noto_Serif_TC({
  weight: ["400", "600"],
  variable: "--font-noto-serif-tc",
  display: "swap",
  preload: false,
});

const fontVars = [
  fraunces.variable,
  sourceSans.variable,
  notoSansTC.variable,
  notoSerifTC.variable,
].join(" ");

export const metadata: Metadata = {
  title: "Koma — 零廣告小說閱讀器",
  description: "乾淨、零廣告、一隻陪你夜讀的貓。中文小說閱讀器。",
  manifest: "/manifest.webmanifest",
  // iOS 加到主畫面:用標準 standalone,標題顯示「Koma」而非整串 title
  appleWebApp: { capable: true, title: "Koma", statusBarStyle: "black-translucent" },
};

const THEMES = ["cat-eye-dusk", "ember-night", "clean-paper"];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant" className={fontVars} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="cat-eye-dusk"
          themes={THEMES}
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          {/* 失敗提示 toast。top-center 避開固定在底部的 player；richColors 讓
              error 在三套主題下都明顯(語意紅,不依主題明暗)。 */}
          <Toaster position="top-center" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
