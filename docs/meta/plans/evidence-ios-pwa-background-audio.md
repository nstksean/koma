# 證據查驗報告 — iOS PWA/Web 背景音訊可靠性

**日期**：2026-06-15
**方法**：`/evidence-check` 四維度並行調查(學術 / 業界標準 / 最佳實踐 / 社群+反面)
**緣由**：釐清兩份計畫文件何者適合當「第一步方案」
- 方案 A：`~/.claude/plans/tts-pwa-adaptive-dolphin.md`(TTS 卡拉OK有聲書產品,RN/原生)
- 方案 B：`docs/meta/plans/mvp-stage0-plan.md`(Next.js Web 零廣告閱讀器,已動工)

> ⚠️ **建議段已部分取代(2026-06-15,同日 `/verify-findings` 查證後)**
> 本文的 **Verdict(iOS web/PWA 無法可靠做有聲書式背景播放)仍然有效、且已被查證確認**(plan 查證表 C2 CONFIRMED)。
> **但下方「對『兩者都要、分階段』的可復用邊界」與「建議」兩段已被取代** —— 它們建立在「方案 A = React Native」的舊前提上。查證後 RN-first 已被推翻:
> - **C1**:Capacitor + native audio plugin(音訊走原生 AVPlayer、不經 WKWebView)可在 iOS 背景播放,**重用整個 Next.js web 閱讀器、不必重寫**(caveat:所選 plugin 需自接 `MPRemoteCommandCenter`)。本文 verdict 只打到「用 WebView 播音訊」,打不到「音訊委派給 native plugin」。
> - **C3**:RNTP V5 商用授權 €999~2,499/年(已驗證)。
> 因此「前端 UI 是拋棄品、必須改 RN」**不再成立** —— 真正的拋棄品只有**爬蟲 adapter 實作**;`SourceAdapter` 介面 / Drizzle schema / cache / 閱讀器 UI 全部帶得走。
> **現行 source of truth:[`mvp-stage0-plan.md`](./mvp-stage0-plan.md) §8.5。**
> 本文唯一仍應**前置**採納的主張:**IQT TTS 字級 timestamp 的可行性 spike 應「現在、與 stage-0 解耦」先驗**(它是整個卡拉OK產品的 gating dependency,成本僅一支 script)。

---

## 被驗證主張

> 在 iOS(iPhone)上,以 web/PWA 技術(Safari WKWebView、HTML `<audio>`、Web Audio API、Media Session API)實作的閱讀器,**無法可靠地進行「有聲書式背景播放」**——螢幕關閉、切背景、鎖屏狀態下長時間(數十分鐘)連續播放並自動跳下一章 + 提供鎖屏控制。因此 web-first 閱讀器無法演進成 TTS 有聲書產品,必須改用 React Native / 原生 Swift(AVFoundation)。

**關鍵前提**:需區分「切背景但螢幕亮」vs「螢幕關閉/鎖屏、長時間、自動跳章」。後者才是有聲書的實際情境。

---

## Verdict：WELL-SUPPORTED

(就「螢幕關閉/長時間/自動跳章」的有聲書情境而言)

3 維 FOUND、衝突表全為 AGREE/PARTIAL、無 CONFLICT。iOS PWA/web 無法可靠做有聲書式背景播放,有官方 bug tracker + entitlement 政策 + 多個遷移案例直接背書。

> 免責:subagent 同基底模型可能有系統盲點。關鍵支柱來源(WebKit #261858、Apple Dev Forums #762582 / #781787)建議自行點開確認。

---

## 跨維度衝突分析

| 衝突點 | D1 學術 | D2 業界標準/官方 | D3 最佳實踐 | D4 社群+反面 | 判定 |
|--------|---------|------|------|------|------|
| iOS PWA standalone 鎖屏/螢幕關閉長時間播放 | NO-DATA | WebKit #261858 OPEN、entitlement 不開放 PWA | Prototyp 實測失敗→改 RN | audiobookshelf #2655、跨 2019–2026 共識 | **AGREE(反駁可行性)** |
| Safari 分頁、螢幕亮著切背景 | NO-DATA | API 存在(caniuse 自 iOS 15) | iOS 15.4 後基本可,不穩 | 有條件成功案例 | **PARTIAL(這情境較可行)** |
| 自動跳下一章(鎖屏中) | NO-DATA | #261858 未修 | 不可行 | 幾乎無成功案例 | **AGREE(反駁)** |
| 必須改用 RN/原生才能做有聲書 | NO-DATA | entitlement 僅原生可用 | RNTP 生產案例完整可用 | 多個團隊遷移 RN | **AGREE(支持)** |

無真正 CONFLICT。唯一保留意見:「螢幕亮著切背景」在 Safari 分頁較可行——但非有聲書情境。

---

## 維度摘要

| 維度 | 覆蓋狀態 | 信心度 | 主要依據 |
|------|---------|--------|---------|
| D1 學術研究 | NOT-FOUND | LOW | 無直接文獻(僅 2013–2020 通論) |
| D2 業界標準/官方 | FOUND | HIGH | WebKit #261858(OPEN)、Apple entitlement 政策、W3C Audio Session explainer 自承缺口 |
| D3 最佳實踐 | FOUND | HIGH | canonical pattern 是 `<audio>`+Media Session,但 standalone 鎖屏失效;Prototyp 改 RN |
| D4 社群+反面 | FOUND | HIGH | 跨 2019–2026 壓倒性共識,silent-audio hack 已死 |

---

## 情境差異對照(理解此問題的關鍵)

| 情境 | Safari 分頁 | 安裝 PWA(standalone) |
|------|------------|----------------------|
| 切到其他 app(螢幕亮) | 通常可繼續 | iOS 15.4 後基本可,iOS 26 出現新 regression |
| **螢幕關閉/鎖屏** | 不穩定,曲目邊界常停 | **大多完全停止,或暫停 30 秒後無法恢復** |
| 鎖屏中自動跳下一章 | 不可靠 | 幾乎不可行(#261858 未修) |

---

## 對「兩者都要、分階段」的可復用邊界

| B 的產出 | 能搬到 A 嗎? | 說明 |
|---------|------------|------|
| 後端 SourceAdapter **介面** | ✅ 高度可復用 | A 後端也是 Next.js,抽象介面直接帶走 |
| Drizzle schema(books/chapters/library/progress) | ✅ 大致可復用 | 資料模型通用 |
| 純 TS 邏輯(解析、cache-key、清洗) | ✅ 可移植 | 不綁 UI |
| 爬蟲 adapter **實作**(ttkan/czbooks) | ⚠️ 拋棄品 | A 內容模型是自帶 EPUB/TXT + 公版書庫,刻意避版權 |
| Next.js 閱讀器**前端 UI** | ❌ 拋棄品 | 音訊要 RN,DOM UI 不移植(React 心智模型可帶,程式碼不可) |

### 建議(排序)

1. **先做 A 的 Phase 0 spike,與 B 完全解耦**:整個產品的 gating dependency 是「IQT TTS 能否合成時回傳 char/word timestamp」。一支呼叫自家 API 的後端 script,不碰 UI,成本極低,但失敗→卡拉OK產品不存在。
2. **B 當「個人零廣告閱讀器 + 後端練手」可做,但刻意限縮**:投資集中在後端(可搬到 A);前端當拋棄式原型,別過度打磨;認清爬蟲 adapter 是自用拋棄品。
3. **別把 B「演進」成 A**:不同平台(Web vs RN)、不同內容模型(爬蟲 vs 自帶+公版)。共享的是後端與閱讀體驗的理解,不是同一份程式碼。

---

## 來源

**業界標準 / 官方**
- [WebKit Bug #261858 — PWA standalone Media Session 鎖屏失效(OPEN, 2023)](https://bugs.webkit.org/show_bug.cgi?id=261858)
- [WebKit Bug #237878 — AudioContext 背景被 suspend(2022)](https://bugs.webkit.org/show_bug.cgi?id=237878)
- [WebKit Bug #198277 — standalone PWA 背景停播(iOS 15.4 修)](https://bugs.webkit.org/show_bug.cgi?id=198277)
- [Apple Dev Forums #762582 — PWA 鎖屏暫停 30 秒後失效(2024)](https://developer.apple.com/forums/thread/762582)
- [Apple Dev Forums #781787 — WKWebView 背景音訊 entitlement 不開放(2024)](https://developer.apple.com/forums/thread/781787)
- [W3C Media Session API](https://www.w3.org/TR/mediasession/)
- [W3C Audio Session API Explainer](https://github.com/w3c/audio-session/blob/main/explainer.md)
- [caniuse — Media Session API](https://caniuse.com/media-session-api)

**最佳實踐 / 生產案例**
- [Prototyp — What we learned about PWAs and audio playback(改用 RN)](https://dev.to/prototyp/what-we-learned-about-pwas-and-audio-playback-50eh)
- [David Bushell — iOS Web Apps and Media Session API(2023)](https://dbushell.com/2023/03/20/ios-pwa-media-session-api/)
- [react-native-track-player with Expo, lock screen iOS(2024)](https://medium.com/@gionata.brunel/implementing-react-native-track-player-with-expo-including-lock-screen-part-1-ios-9552fea5178c)
- [react-native-track-player GitHub](https://github.com/doublesymmetry/react-native-track-player)

**社群 + 反面**
- [audiobookshelf Issue #2655 — 每章結束後停止(iOS 17+)](https://github.com/advplyr/audiobookshelf/issues/2655)
- [MacRumors — iOS 26 PWA 音訊問題(2025)](https://forums.macrumors.com/threads/ios-26-audio-issues-in-pwa-web-apps-not-fixed-in-26-1-or-26-2-but-much-better.2466839/)
- [MagicBell — PWA iOS Limitations(2026)](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- [Discourse Meta — Media playback with PWA when phone locked](https://meta.discourse.org/t/media-playback-with-pwa-keep-playing-when-phone-locked/182219)
