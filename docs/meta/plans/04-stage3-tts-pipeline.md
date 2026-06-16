# 04 — 階段 3：TTS 聽書 pipeline（執行文件）

**日期**：2026-06-15（2026-06-16 補 Azure 真打實測結論，見 §2.1）
**對應**：階段 3（TTS 卡拉OK聽書）；[`mvp-stage0-plan.md` §8.5](./mvp-stage0-plan.md)、[`spike-native-plugin.md`](../assessments/spike-native-plugin.md)、[`evidence-ios-pwa-background-audio.md`](./evidence-ios-pwa-background-audio.md)
**前置**：stage-0（[01](./01-foundation-and-data-layer.md)/[02](./02-fetch-and-api-layer.md)/[03](./03-pages-and-reader-ux.md)）閱讀器可用；**IQT char-level timestamp spike 結果**（[`scripts/spike-tts-iqt.ts`](../../../scripts/spike-tts-iqt.ts)）
**狀態**：📝 規劃中（只描述怎麼做，**尚未動程式碼**；本階段不碰 `db/`，僅盤點欄位需求）

> 延續 01～03 的執行文件體例（任務分解 + DoD + 驗收）。本文件描述「聽書」如何在**不重寫 stage-0 web 閱讀器**的前提下長出來。
> 核心策略（§8.5）：**音源層與播放管線層解耦**。過渡期音源用 **Azure 暫代**，最終換 **自家 IQT**——**換源只動「音源 Provider」，不動 player / 同步 / 高亮**。

---

## 0. 兩層解耦總覽

```
┌─────────────────────────────────────────────────────────────┐
│  音源層（可抽換）   AudioSourceProvider                       │
│    Azure（過渡暫代） / IQT（最終目標） / ElevenLabs（備選）    │
│    輸出統一形狀：{ audioFileUrl, charTimestamps[] }            │
└───────────────────────────┬─────────────────────────────────┘
                            │  統一資料形狀（換源不變）
┌───────────────────────────▼─────────────────────────────────┐
│  播放管線層（不重寫）                                          │
│    PlayerEngine（native plugin，見 spike-native-plugin.md）   │
│      └ 背景播放 / 鎖屏控制 / 自動跳章 / 變速 / seek            │
│    逐字高亮同步器（char-level，binary-search timing map）      │
└─────────────────────────────────────────────────────────────┘
```

**換源切點**：上層 `PlayerEngine` 與「逐字高亮同步器」只認**統一資料形狀**（§3 的 `ChapterAudio`）。換音源（Azure→IQT）= 只換實作 `AudioSourceProvider` 的那一個檔，player / 同步 / 高亮**一行不動**。這是本階段最重要的設計約束。

---

## 1. 任務分解

| # | 任務 | 產出 | 依賴 |
|---|------|------|------|
| T1 | **IQT char-level timestamp spike**（gating） | `scripts/spike-tts-iqt.ts` 真跑出 timestamp 結構 | IQT endpoint + 認證 |
| T2 | 定義 **音源 Provider 抽象** `AudioSourceProvider` + 統一資料形狀 `ChapterAudio` | 介面定義（純 TS） | — |
| T3 | 實作 **Azure provider**（過渡暫代） | `azureProvider`（Batch synthesis → audio + word boundary JSON） | T2、`scripts/spike-tts-azure.ts` |
| T4 | 設計 **timestamp JSON schema** + per-chapter 合成流程 | schema 草案（§3） | T2 |
| T5 | 設計 **音檔快取策略**（per-chapter 預合成、落地、失效） | 快取規格（§4） | T3/T4 |
| T6 | 選定 / 接上 **PlayerEngine（native plugin）** | 見 [`spike-native-plugin.md`](../assessments/spike-native-plugin.md) | native plugin 選型 |
| T7 | 實作 **逐字高亮同步器**（binary-search timing map + 變速換算） | 同步器（純 TS，可單測） | T4、T6 |
| T8 | 接上 **IQT provider**（換源驗證：上層不動） | `iqtProvider` | T1、T2 |
| T9 | DoD 驗收（§7） | 整條鏈路在實機綠燈 | T1–T8 |

> T1 是 **gating dependency**：IQT 吐不出對齊音檔的 char-level timestamp → 逐字卡拉OK核心賣點不存在。故 T1 與 stage-0 解耦、現在就驗（§8.5）。在 T1 未過前，T3 Azure provider 可先把整條管線跑通（暫代音源），不阻塞。

---

## 2. 音源 Provider 抽象（換源切點，純 TS）

```ts
// 統一資料形狀：任何音源都輸出這個，上層只認它
interface CharTimestamp {
  char: string;        // 單一漢字（或標點，視 includesPunctuation 而定）
  charIndex: number;   // 在「該章純文字」中的 char index（定義見 §3）
  startMs: number;     // 對齊 audioFile 的起始毫秒
  endMs: number;       // 結束毫秒（通常 = 下一字 startMs）
}

interface ChapterAudio {
  bookId: number;
  chapterId: number;
  source: "azure" | "iqt" | "eleven";  // 哪個引擎合成的（快取鍵的一部分）
  voice: string;                        // 音色 id
  audioFileUrl: string;                 // 落地後的本機 / CDN 音檔路徑
  durationMs: number;
  charTimestamps: CharTimestamp[];      // 逐字 timing
  includesPunctuation: boolean;         // charIndex 是否把標點算進去
  schemaVersion: 1;
}

// 音源抽象：換源只換實作這個介面的檔，player/高亮不動
interface AudioSourceProvider {
  readonly id: "azure" | "iqt" | "eleven";
  // 把一章純文字合成成「音檔 + 逐字 timestamp」
  synthesizeChapter(input: {
    bookId: number;
    chapterId: number;
    plainText: string;   // 已清洗的章節純文字（沿用 02 的清洗結果）
    voice: string;
  }): Promise<ChapterAudio>;
}
```

- **Azure provider（T3）**：走 **Batch synthesis** REST（長文離線合成），合成後下載 audio + `*.word.json` boundary 檔，把 word boundary 正規化成 `CharTimestamp[]`。⚠️ **實測 Azure 對中文落「詞級」非字級**（見 §2.1），故正規化時須把多字詞 boundary **依字數均分時間切到字級**；`audioOffset_100ns / 10000 = startMs`。見 [`scripts/spike-tts-azure.ts`](../../../scripts/spike-tts-azure.ts)。
- **IQT provider（T8）**：對齊 [`scripts/spike-tts-iqt.ts`](../../../scripts/spike-tts-iqt.ts) 的 `parseResponse`，把 IQT 回傳 map 成同一個 `CharTimestamp[]`。**這一步只新增一個檔，上層零改動** —— 即「換源不重寫」的兌現點。
- **ElevenLabs provider（備選）**：`with-timestamps` 的 `alignment.characters` 直接就是 per-char，map 最直接（見 [`scripts/spike-tts-eleven.ts`](../../../scripts/spike-tts-eleven.ts)）。

---

## 2.1 Azure 真打實測結論（2026-06-16，T2a — 釘死字級未知數）

`npm run spike:tts:azure` 用 Speech SDK 真打 `komaTTS`（region `japaneast`、voice `zh-CN-XiaoxiaoNeural`、文本「夜色漸深,他卻毫無睡意。」）。9 筆 `wordBoundary` 事件實測結果：

| 判定項 | 實測 | 對卡拉OK高亮的影響 |
|--------|------|------|
| **粒度** | ❌ **詞級非純字級** —— 「夜色」「毫無」「睡意」各 `wordLength=2` 一筆，單字詞（漸/深/他/卻）才 `=1` | 不能直接當 char-level 用,**須在 provider 端把多字詞依字數均分時間切到字級** |
| **每筆欄位** | ✅ `textOffset`(char index) + `wordLength`(char 數) + `audioOffset`(÷10000=ms) + `duration` | 有足夠資訊做均分:「夜色」50~450ms → 夜 50~250、色 250~450,誤差 ~100–175ms/字 |
| **標點** | ✅ `,` `。` 標 `Punctuation` 型、不混進 Word | 渲染時略過,呼應 `includesPunctuation:false`（§3.2） |
| **⚠️ offset 基準** | **`textOffset` 是相對整個 SSML 字串(含 `<speak><voice>` 前綴)**,首字「夜」落在 161 而非 0 | **管線雷**:production 要嘛改用 plain-text input（SDK `speakTextAsync`）讓 offset 從 0 起,要嘛減掉 SSML 前綴長度,否則 charIndex 全錯位 |

**淨結論**:Azure 暫代音源**可支撐卡拉OK逐字高亮**——雖非純字級,但詞級 boundary 帶 char offset + duration,均分到字級的 fallback 已驗證可行,**不需為了字級換音源**。production 正解仍走 Batch synthesis 的 `[n].word.json`（欄位與 SDK `wordBoundary` 同構）。此結果讓 §1 的 `CharTimestamp[]` 形狀不變,只是 Azure provider 多一步「詞→字均分」正規化。

> 對照 T1（IQT, gating）:若 IQT 能直接吐**純字級** timestamp,則 IQT provider 連均分都省;Azure 已先證明「就算只有詞級也做得出來」,降低了整個賣點的風險。

### 2.1.1 詞→字均分正規化（可單測純函式）

Azure provider 的核心轉換:把 raw `wordBoundary` 事件 → §2 的 `CharTimestamp[]`。三件事一次做完——**過濾標點 / 依字數均分時間 / 把 SSML-relative offset 正規化回純文字 index**。純函式、無副作用,可獨立單測(對齊 §5.1 `activeCharIndex` 的風格)。

```ts
// Azure SDK wordBoundary 事件的最小形狀(spike 實測欄位)
interface AzureBoundary {
  text: string;          // 該 boundary 文字,中文可能 1–2 字
  textOffset: number;    // ⚠️ 相對整個 SSML 字串(含前綴),非純文字
  wordLength: number;    // 涵蓋 char 數
  startMs: number;       // audioOffset / 10000
  durationMs: number;    // duration / 10000
  type: "Word" | "Punctuation" | "Sentence";
}

/**
 * 把 Azure 詞級 boundary 攤平成字級 CharTimestamp[]。
 * @param offsetBase  SSML 前綴長度(用 speakTextAsync 純文字輸入時為 0;
 *                    用 speakSsmlAsync 時 = ssmlPrefix.length,實測本 spike=161)
 */
function azureWordsToChars(
  boundaries: readonly AzureBoundary[],
  offsetBase: number,
): CharTimestamp[] {
  return boundaries
    .filter((b) => b.type === "Word") // 標點/句界不參與高亮(includesPunctuation:false)
    .flatMap((b) => {
      const chars = [...b.text]; // code-point 切,避免 surrogate pair 出錯
      const per = b.durationMs / chars.length; // 依字數均分(誤差 <~175ms/字)
      return chars.map((c, k) => {
        const start = b.startMs + per * k;
        return {
          char: c,
          charIndex: b.textOffset - offsetBase + k, // 正規化回純文字 index
          startMs: Math.round(start),
          endMs: Math.round(start + per),
        };
      });
    });
  // boundaries 本就按 startMs 遞增 → 輸出已排序,可直餵 §5.1 binary search
}
```

- **詞間停頓**:boundary 間的 gap(實測「深」止 988ms、「,」起 1088ms,中間 100ms 靜音)落在字與字之間的留白,不影響高亮——`activeCharIndex` 在 gap 期間停在前一字即可。若要更貼,可把本詞末字 `endMs` 補到「下一個 Word boundary 的 startMs」。
- **offset 正規化是鐵則**:`offsetBase` 算錯 → 整章 `charIndex` 全平移錯位(§3.2)。最穩做法是 provider 改用 plain-text 輸入讓 `offsetBase=0`,徹底免去 SSML 前綴長度的脆弱依賴。
- **未來相容**:IQT/Eleven 若原生 per-char(`wordLength=1`),此函式對它們是 no-op(每詞一字、均分=原值),等於免費複用同一條正規化路徑。

---

## 3. timestamp JSON schema 草案 + per-chapter 合成

### 3.1 落地形狀（per chapter 一個 JSON + 一個音檔）

```jsonc
// <cacheDir>/<source>/<voice>/<bookId>/<chapterId>.json
{
  "schemaVersion": 1,
  "bookId": 123,
  "chapterId": 456,
  "source": "azure",
  "voice": "zh-CN-XiaoxiaoNeural",
  "audioFile": "456.mp3",          // 同目錄相對路徑
  "durationMs": 18230,
  "includesPunctuation": false,    // charIndex 對應的是「去標點純文字」
  "textHash": "sha256:…",          // 來源純文字 hash（內文變了就失效，見 §4）
  "chars": [
    { "i": 0, "c": "夜", "s": 0,    "e": 120 },
    { "i": 1, "c": "色", "s": 120,  "e": 250 },
    { "i": 2, "c": "漸", "s": 250,  "e": 410 }
    // …每個漢字一筆；s=startMs e=endMs
  ]
}
```

### 3.2 charIndex 的定義（必須與閱讀器渲染對齊）

- `charIndex` 是針對**「該章純文字、依 `includesPunctuation` 決定是否含標點」** 的 code-point index（用 `[...text]` 而非 `.length`，避免 surrogate pair）。
- **高亮對齊鐵則**：閱讀器渲染逐字時，DOM 的每個可高亮 char 要能對應到同一套 `charIndex`。建議渲染時就把章節文字 `[...text].map((c, i) => <span data-ci={i}>)`，高亮即 `querySelector([data-ci="${i}"])`。
- 標點是否參與高亮由 `includesPunctuation` 決定，**provider 與渲染必須用同一個約定**（否則 index 會錯位）。Azure word boundary 通常不單獨給標點 → `includesPunctuation: false`，渲染時標點不掛 `data-ci`。

### 3.3 per-chapter 合成流程

1. 取該章已清洗純文字（沿用 [02](./02-fetch-and-api-layer.md) 的清洗輸出）。
2. 算 `textHash`（內文變更偵測用）。
3. 查快取（§4）；命中且 `textHash` 一致 → 直接用。
4. 未命中 → 呼叫當前 `AudioSourceProvider.synthesizeChapter` → 落地 audio + JSON。
5. 回傳 `ChapterAudio` 給 player。

> **欄位需求盤點（不碰 `db/`，僅記錄階段 3 實裝時要加的表）**：階段 3 會需要一張 `chapter_audio`（`bookId, chapterId, source, voice, audioFile, durationMs, textHash, schemaVersion, synthesizedAt`，對 `(chapterId, source, voice)` 唯一）。**本階段只在此盤點，不建表、不改 schema**（呼應任務邊界）。

---

## 4. 音檔快取策略

- **粒度**：per-chapter（一章一個 audio + 一個 timestamp JSON）。聽書是順序消費，章為自然單位，也對齊 native plugin 的「一章一 track、播完跳下一章」。
- **快取鍵**：`(source, voice, bookId, chapterId, textHash)`。
  - `source`/`voice` 入鍵 → **換源（Azure→IQT）或換音色不會撞快取**，可並存。
  - `textHash` 入鍵 → **來源內文更新（斷更補上、修錯字）自動失效重合成**。
- **落地位置**：
  - 過渡 / 開發：本機檔案系統（`<cacheDir>/<source>/<voice>/<bookId>/`）。
  - 上架：Capacitor `Filesystem`（裝置端）；可選 CDN 預熱熱門書。
- **預合成 vs 即時**：**預合成優先**（離線、可在背景把整本批次合成，聽的時候零延遲）。Azure Batch synthesis 本就是離線長文合成，天然契合。
- **失效 / 清理**：`textHash` 不符即重合成；提供「清掉某書音檔」與容量上限 LRU 淘汰（裝置儲存有限）。
- **預取**：播第 N 章時，背景預合成 N+1 章，避免跳章時的合成等待。

---

## 5. 逐字高亮 char-level 同步思路

### 5.1 timing map + binary search

- 把 `chars[]`（已按 `startMs` 遞增）當成查找表。播放時拿 player 回拋的 `currentMs`，用 **binary search** 找「最後一個 `startMs <= currentMs` 的 char」即為當前高亮字。
  - O(log n) per frame，整章上千字也無感。
- player 的 `currentMs` 回拋頻率若不足以支撐 ~100ms 一字（中文一字 ≈ 100ms，屬精度邊界，見 §8.5 修正 2），就在 web 層用 `requestAnimationFrame` 內插：以「上次回拋 currentMs + 經過的牆鐘時間 × rate」估算當前 ms，binary search 仍用估算值。**真相仍是 player 的 currentMs，rAF 只做幀間補點**，避免高亮卡頓。

```ts
// 純函式、可單測：給定 timing map 與當前 ms，回傳該高亮的 charIndex
function activeCharIndex(chars: CharTimestamp[], currentMs: number): number {
  let lo = 0, hi = chars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chars[mid].startMs <= currentMs) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans; // -1 = 尚未開始
}
```

### 5.2 變速（rate）換算

- **timestamp 永遠存「1.0× 的毫秒」**（合成當下的時間軸），不因使用者變速而改寫。
- 變速時：player 的 `currentMs` 本身就是「該音檔的播放位置毫秒」（AVPlayer 變 rate 不改 currentTime 的語意），所以 **binary search 直接用 player 回拋的 currentMs 即可，timing map 不需縮放**。
- 只有在用 §5.1 的 rAF 內插估算時，要把「牆鐘經過時間 × rate」算進去（rate=2 時牆鐘 50ms ≈ 音檔 100ms）。
- seek（逐字回跳）：點某字 → 取該字 `startMs` → `player.seekTo(startMs)`；變速不影響(seek 的目標是音檔時間軸)。

### 5.3 與 PlayerEngine 的介面

- 同步器只依賴 player 暴露的：`currentMs`（回拋 / 可查詢）、`rate`、`seekTo(ms)`、`onEnded`（跳章）。這組介面與 [`spike-native-plugin.md`](../assessments/spike-native-plugin.md) 的 `PlayerEngine` 待驗清單對齊；**換 plugin（現成↔自寫）只要這組介面不變,同步器不動**。

---

## 6. 換源演進路徑（Azure → IQT，兌現「不重寫」）

1. **現在（與 stage-0 平行）**：跑 [`spike-tts-iqt.ts`](../../../scripts/spike-tts-iqt.ts) 驗 IQT 能否吐字級 timestamp（T1, gating）。
2. **過渡**：用 `azureProvider`（T3）把整條 pipeline + 高亮 + native 播放打通。此時產品已能聽書、能逐字高亮，只是音源是 Azure。
3. **切換**：IQT spike 過關後，實作 `iqtProvider`（T8）——**只新增一個實作 `AudioSourceProvider` 的檔**，把 app 的 provider 從 `azureProvider` 換成 `iqtProvider`。player / 同步 / 高亮 / 快取 / schema **全部不動**。
4. **驗證換源無回歸**：同一章用兩個 provider 各合成一次，比對 `ChapterAudio` 形狀一致、高亮在實機表現一致。

---

## 7. DoD（階段 3 完成定義）

- [ ] **T1**：`npm run spike:tts:iqt` 在填好 endpoint/auth 後**真跑**，印出 IQT 回傳結構，且**確認為 char-level**（中文每漢字一筆、startMs 對齊音檔）。若非字級 → 升級為阻斷議題回報 IQT 團隊。
- [ ] `AudioSourceProvider` 抽象 + `ChapterAudio` 形狀定稿，Azure / IQT / Eleven 三 provider 輸出同一形狀。
- [ ] Azure provider 能 per-chapter 合成出 audio + timestamp JSON（schema §3），`includesPunctuation` 與渲染約定一致。
- [ ] 音檔快取：同章重播不重合成；改內文（`textHash` 變）自動重合成；換音色 / 換源不撞快取。
- [ ] native plugin（[`spike-native-plugin.md`](../assessments/spike-native-plugin.md)）實機通過：**鎖屏控制（`MPRemoteCommandCenter`）**、背景 30 分鐘不斷音、自動跳章、變速、seek。
- [ ] 逐字高亮：實機播放時高亮逐字跟拍；變速（0.5×–3×）下仍對齊；點字 seek 正確；`activeCharIndex` 有單元測試（沿用 testing 規範 80%）。
- [ ] **換源驗證**：把 provider 從 Azure 換成 IQT，player / 同步 / 高亮 **零改動**，整條鏈路仍綠。

---

## 8. 風險與雷區

| 雷 | 症狀 | 對策 |
|----|------|------|
| ⚠️ IQT 吐不出字級 timestamp | 逐字卡拉OK核心賣點不存在 | T1 現在就驗（gating）；備選 ElevenLabs（原生 per-char） |
| ⚠️ native plugin 缺 `MPRemoteCommandCenter` | 鎖屏只能看不能控 | 見 spike-native-plugin §3：退路是自寫 thin plugin 直接接 |
| ⚠️ charIndex 與渲染錯位 | 高亮跳到錯字 | §3.2：provider 與渲染共用同一 `includesPunctuation` 約定 + `data-ci` |
| ⚠️ **Azure 詞級非字級**（已實測 §2.1） | 2-char 詞只給一個 boundary，整詞同時高亮 | provider 正規化時依字數**均分詞內時間**切到字級（誤差 ~100ms/字，可接受） |
| ⚠️ **Azure `textOffset` 為 SSML-relative**（已實測 §2.1） | 首字 offset=161 非 0，charIndex 全錯位 | 改用 plain-text input（`speakTextAsync`）讓 offset 從 0 起，或減掉 SSML 前綴長度 |
| ⚠️ 中文一字 ~100ms 精度邊界 | 高亮卡頓 / 跟不上 | §5.1 rAF 內插補幀；player currentMs 回拋頻率列入 plugin 待驗 |
| ⚠️ 變速後高亮漂移 | 2× 時高亮錯位 | §5.2：timestamp 存 1.0× ms，binary search 直接用 player currentMs |
| ⚠️ 音檔塞爆裝置 | 儲存不足 | §4：LRU 淘汰 + 容量上限 + 按書清理 |
| ⚠️ Azure Batch 合成非即時 | 第一次聽要等 | §4：預合成 + N+1 章預取 |

---

## 9. 交叉引用

- **方向依據**：[`mvp-stage0-plan.md` §8.5](./mvp-stage0-plan.md)（Capacitor + native plugin、IQT 字級 timestamp 規格、spike 先行）
- **背景播放查證**：[`evidence-ios-pwa-background-audio.md`](./evidence-ios-pwa-background-audio.md)
- **plugin 選型**：[`spike-native-plugin.md`](../assessments/spike-native-plugin.md)
- **spike scripts**：[`scripts/spike-tts-azure.ts`](../../../scripts/spike-tts-azure.ts)（暫代音源 + word boundary 規格）、[`scripts/spike-tts-iqt.ts`](../../../scripts/spike-tts-iqt.ts)（最高槓桿 gating）、[`scripts/spike-tts-eleven.ts`](../../../scripts/spike-tts-eleven.ts)（備選）
- **stage-0 管線**：[02](./02-fetch-and-api-layer.md)（清洗純文字來源）、[03](./03-pages-and-reader-ux.md)（閱讀器渲染，逐字高亮掛在其上）
