# Spike — Capacitor native audio plugin 選型（聽書背景播放）

**日期**：2026-06-15
**對應**：階段 3（TTS 聽書）；[`mvp-stage0-plan.md` §8.5 修正 1](./mvp-stage0-plan.md)、[`evidence-ios-pwa-background-audio.md`](./evidence-ios-pwa-background-audio.md)
**狀態**：📝 選型調查（不進 app 實裝；本文件只做選型與待驗清單）

> **一句話**：階段 3 走 **Capacitor + 底層 AVPlayer 的 native audio plugin**（重用整個 Next.js web 閱讀器），
> 而 plugin 選型的**唯一缺證關鍵**是：該 plugin 是否自接 `MPRemoteCommandCenter`（iOS 鎖屏 / 控制中心 / 耳機控制）。
> 本文件把這個缺證處鎖死成「選型 gate」，並給出候選對比與待實機確認清單。

---

## 0. 為什麼是這個問題（背景收斂）

`evidence-ios-pwa-background-audio.md` 已查證確認：iOS 上**純 web / PWA（WKWebView + `<audio>` + Media Session）無法可靠做有聲書式背景播放**（螢幕關閉 / 鎖屏 / 長時間 / 自動跳章），WKWebView 拿不到背景音訊 entitlement，暫停 30s 後即斷音。

§8.5 的方向修正是：**不重寫成 RN**（RNTP V5 商用授權 €999~2,499/年、要重學 RN），改用 **Capacitor 殼包住現有 Next.js web**，**只把「音訊播放」這一層委派給原生 plugin**（底層 AVPlayer / AVAudioSession，不經 WKWebView）。如此：

- web 閱讀器 UI、`SourceAdapter`、Drizzle schema、cache、逐字高亮邏輯**全部帶得走、不重寫**。
- 真正需要原生的只有「播放引擎 + 鎖屏控制 + 背景音訊 session」這一薄層。

因此選型的核心不是「能不能播」，而是 **iOS 背景 / 鎖屏整套體驗是否齊備**，其中 `MPRemoteCommandCenter`（鎖屏控制）是既有文件標記的**唯一缺證處**。

---

## 1. iOS 背景有聲書「必備能力」清單（評選維度）

一個 plugin 要能撐起聽書，下列每項都要有；缺一項就要自己寫原生補丁：

| 能力 | 說明 | 為何必要 |
|------|------|---------|
| **AVAudioSession `playback` category** | 宣告為播放型 app，螢幕關閉 / 切背景仍出聲 | 背景持續播放的根本 |
| **`UIBackgroundModes: audio`（Info.plist）** | App 宣告背景音訊能力 | 沒有則背景被 suspend |
| **底層走 AVPlayer / AVAudioPlayer（非 WKWebView `<audio>`）** | 音訊解碼在原生層 | 繞過 WKWebView entitlement 缺口 |
| **`MPNowPlayingInfoCenter`** | 鎖屏 / 控制中心顯示「正在播放」資訊（標題、章節、封面、進度） | 鎖屏資訊卡 |
| **★ `MPRemoteCommandCenter`** | 鎖屏 / 控制中心 / 耳機的「播放、暫停、上一首、下一首、快轉」實體控制 | **唯一缺證關鍵**：沒有它，鎖屏只能看不能控 |
| **播放結束事件 / 佇列** | 一章播完能自動接下一章 | 自動跳章（有聲書核心情境） |
| **變速（rate）** | 0.5×～3× 倍速 | 聽書必備；且影響逐字高亮的時間換算 |
| **seek 到任意 ms** | 跳轉到指定時間 | 逐字進度回跳、章內定位 |
| **音訊中斷處理（來電 / 其他 app）** | interruption begin/end 通知 | 來電後能正確暫停 / 續播 |

> ★ 標記項 = 既有文件（§8.5、evidence 文件 C1 caveat）標明「唯一缺證處」。

---

## 2. 候選 plugin 對比

> ⚠️ 本表為**離線知識盤點**；本環境無法上網 / 無實機，每項「是否自接 `MPRemoteCommandCenter`」**最終須以實機 + 該版本原始碼確認**（見 §4 待驗清單）。標 `需查證` 者尤其不可當定論。

| Plugin | 底層 | 背景播放 | `MPNowPlayingInfoCenter`（鎖屏資訊） | ★ `MPRemoteCommandCenter`（鎖屏控制） | 變速 | 維護狀態 | 備註 |
|--------|------|---------|--------------------------------------|----------------------------------------|------|---------|------|
| **`@capgo/native-audio`** | 原生 AVAudioPlayer（iOS）/ ExoPlayer 概念（Android） | ✅ 支援背景 | ⚠️ `需查證`（部分版本有 now-playing 設定 API） | ⚠️ **`需查證`（缺證關鍵；近期版本宣稱有 remote control / background 強化，須核版本與原始碼）** | ✅ 有 rate API | 活躍（Capgo 維護，更新頻繁） | §8.5 點名的首選；正因鎖屏控制缺證，本文件把它列為主要實機驗證對象 |
| **`@capacitor-community/native-audio`** | 原生短音播放為主 | ⚠️ 偏「音效 / 短音」 | ❌ 多半無 | ❌ 多半無 | 有限 | 社群維護 | 設計目標是 SFX / 短音效，**不適合長時間有聲書**；列為對照 |
| Capacitor 內建 / web `<audio>` | WKWebView | ❌（已查證不可靠） | Media Session（鎖屏資訊有限） | ❌（鎖屏控制在 standalone 失效） | web rate | — | 即 evidence 文件已否決的路；列此說明為何不能只靠它 |
| **自寫 Capacitor plugin（thin 原生層）** | 自選 AVPlayer / AVQueuePlayer | ✅ 完全可控 | ✅ 自接 | ✅ **自接（保證有）** | ✅ 自接 | 自維護 | 後備方案：若現成 plugin 鎖屏控制不齊，寫一個薄 plugin 直接接 `MPRemoteCommandCenter` + `MPNowPlayingInfoCenter`，工作量可控（單一 Swift 檔級別） |

### 解讀

- `@capacitor-community/native-audio` 的設計初衷是**遊戲音效 / 短音**，不是長時間串流有聲書 —— 鎖屏控制與背景續播多半不齊，**先排除為主力**。
- `@capgo/native-audio` 是 §8.5 點名首選，**背景播放與 rate 較完整**，但**鎖屏控制（`MPRemoteCommandCenter`）是缺證關鍵**，必須在實機 + 對應版本原始碼上確認，不能憑文件字面。
- **最穩的退路**是「自寫 thin plugin」：AVQueuePlayer 接佇列自動跳章 + 顯式接 `MPRemoteCommandCenter` / `MPNowPlayingInfoCenter` / interruption。工作量是「一個 Swift plugin 檔」等級，且把最關鍵的鎖屏控制權握在自己手上。**逐字高亮所需的 currentTime 回拋頻率**（見 [`04` §逐字高亮同步](./04-stage3-tts-pipeline.md)）也由自寫層精準控制。

---

## 3. 選型建議

1. **第一順位：實機驗證 `@capgo/native-audio` 的 `MPRemoteCommandCenter`**。若該版本確實自接鎖屏 play/pause/next/prev + now-playing 資訊 + 背景續播 + rate，則**直接採用**，省下自寫成本。
2. **退路（若第 1 項缺鎖屏控制）：自寫 thin Capacitor audio plugin**。用 `AVQueuePlayer` + 顯式接 `MPRemoteCommandCenter` / `MPNowPlayingInfoCenter` / `AVAudioSession(.playback)` / interruption。把這層做成乾淨的原生介面，對齊 [`04` §音源 Provider 抽象](./04-stage3-tts-pipeline.md) 的 `PlayerEngine` 契約。
3. **排除：`@capacitor-community/native-audio` 當主力**（SFX 取向）。
4. **不選：RN + RNTP**（§8.5 已定，授權費 + 重寫成本）。

> 不論採現成或自寫，**對 web 層暴露的播放介面要先抽象成 `PlayerEngine`**（見 04），讓「現成 plugin ↔ 自寫 plugin」之間可替換，不綁死選型結果。

---

## 4. 待實機 / 待上網確認清單（本環境無法定論者）

下列每項都需**真機（實體 iPhone，非模擬器，因背景音訊 / 鎖屏行為模擬器不準）** 或上網查對應版本原始碼確認：

- [ ] **★ `@capgo/native-audio` 目標版本是否自接 `MPRemoteCommandCenter`**（鎖屏 / 控制中心 / 耳機的 play/pause/next/prev/seek）—— 查 plugin 的 iOS Swift 原始碼是否有 `MPRemoteCommandCenter.shared()` 註冊。**這是整個選型的 gate。**
- [ ] 是否設定 `MPNowPlayingInfoCenter`（鎖屏顯示書名 / 章節 / 封面 / 進度條）。
- [ ] 是否在 iOS 設定 `AVAudioSession` category = `.playback` 且 active。
- [ ] **螢幕關閉 + 鎖屏 + 連續播放 30 分鐘以上**不斷音（對應 evidence 文件最嚴苛情境）。
- [ ] **一章播完自動接下一章**（背景 / 鎖屏狀態下）—— 對應 audiobookshelf #2655 的 iOS 痛點。
- [ ] **變速（0.5×–3×）** 是否支援、變速後鎖屏進度與逐字高亮是否仍對齊。
- [ ] seek 到任意 ms 是否準確（逐字回跳需要）。
- [ ] 來電 / 其他 app 搶音（interruption）後能否正確暫停與續播。
- [ ] currentTime 回拋頻率是否足夠支撐 char-level 逐字高亮（~100ms 一字，見 04）；不足則需自寫層提高回拋率或在 web 層用 rAF 內插。
- [ ] Android 對等能力（ExoPlayer / `MediaSessionCompat`）—— MVP 以 iOS 為主，但記錄落差。

---

## 5. 結論

- **方向確立**：Capacitor + native audio plugin，重用整個 web，不重寫、不上 RN。
- **選型 gate**：`@capgo/native-audio` 是否自接 `MPRemoteCommandCenter` —— **本環境無法定論，標為實機待驗**；驗過則採用，否則走「自寫 thin plugin」退路（保證接得到鎖屏控制）。
- **解耦保險**：對 web 暴露 `PlayerEngine` 抽象（見 [`04`](./04-stage3-tts-pipeline.md)），讓 plugin 可替換、選型結果不綁死下游。

---

**相關文件**：[`04-stage3-tts-pipeline.md`](./04-stage3-tts-pipeline.md)（pipeline 與 `PlayerEngine` / 音源 Provider 抽象）、[`evidence-ios-pwa-background-audio.md`](./evidence-ios-pwa-background-audio.md)（背景播放查證）、[`mvp-stage0-plan.md` §8.5](./mvp-stage0-plan.md)
