# plans/ — 計畫、執行文件、roadmap

Koma 的實作計畫與分階段執行文件。每份檔案開頭標註日期與狀態;`mvp-stage0-plan.md` 為 stage-0 權威計畫,01～03 是它的執行分解,04 是階段 3。

## 文件索引

| 文件 | 用途 | 狀態 |
|---|---|---|
| [mvp-stage0-plan.md](mvp-stage0-plan.md) | **stage-0 MVP 權威計畫**:範圍 / 架構 / 任務分解 / DoD;含 §8.5 階段 3 方向修正。 | ✅ stage-0 已完成(§8.5 stage-3 方向 → doc 04) |
| [01-foundation-and-data-layer.md](01-foundation-and-data-layer.md) | 執行文件①:專案地基 + Drizzle schema + migration。 | ✅ 已完成(`276af08`) |
| [02-fetch-and-api-layer.md](02-fetch-and-api-layer.md) | 執行文件②:`SourceAdapter` 收斂 + 資料層 + 快取 + fixture 測試。 | ✅ 已完成(`276af08`) |
| [03-pages-and-reader-ux.md](03-pages-and-reader-ux.md) | 執行文件③:頁面 + 閱讀器體驗 + E2E + DoD 驗收。 | ✅ 已完成(`276af08` 起) |
| [04-stage3-tts-pipeline.md](04-stage3-tts-pipeline.md) | 執行文件④:階段 3 TTS 聽書 pipeline(音源層 / 播放管線層解耦)。 | 🚧 實作中 |
| [better-auth-email-otp.md](better-auth-email-otp.md) | better-auth 登入(雙系統並存、額度綁 userId)。 | ✅ 已上線(`11697c6`);⚠️ OTP 已於 2026-06-26 改為 email+密碼 |
| [evidence-ios-pwa-background-audio.md](evidence-ios-pwa-background-audio.md) | `/evidence-check` 報告:iOS web/PWA 背景音訊可靠性。驗證 `mvp-stage0-plan.md` §8.5。 | 調查報告 · **推進前必讀** |

> **01–03 已畢業(2026-06-17 對齊):** 三份執行文件原自述「尚未動程式碼」,現已全部實作落地(initial commit `276af08` 起),狀態行已標 ✅ 並各自註明與計畫的偏差(02:Route Handlers→Server Actions;03:首發來源 czbooks→ttkan)。stage-0 §7 DoD 六項實質達成。
>
> **evidence 報告的取捨:** 其 **Verdict(iOS 純 web/PWA 無法可靠做有聲書式背景播放)仍有效且已查證**;但「建議段」建立在舊的「方案 A = React Native」前提上,**已被 §8.5(Capacitor + native audio plugin、重用整個 web)取代**。現行 source of truth = `mvp-stage0-plan.md` §8.5。

另見:[../README.md](../README.md) meta 總覽。
