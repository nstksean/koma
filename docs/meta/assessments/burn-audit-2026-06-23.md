# Burn-Audit 全 repo 稽核報告 — 2026-06-23

> 由 multi-agent workflow `koma-burn-audit` 產出。154 個 agent、約 690 萬 tokens、31 分鐘。
> 稽核 6 維度(bug / 資安 / 效能 / 過度設計 / TTS pipeline / 規範)各派 finder,
> **每個 finding 開 3 個獨立反證者實讀檔交叉驗證,≥2 票才列入**。
> 結果:40 findings → **20 確認** / 20 被反證砍掉。

## 摘要

| 嚴重度 | 數量 | 主題 |
|---|---|---|
| 🔴 Critical | 1 | 未認證付費合成帳單 DoS |
| 🟠 High | 5 | 額度競態、over-fetch、記憶體尖峰、非 BMP 高亮錯位 |
| 🟡 Medium | 4 | 無 rate limit、額度只 prod 強制、re-render |
| ⚪ Low | 10 | 細節、規範、邊界 |

**最該先修(同一條成本/帳單 DoS 攻擊鏈):** Critical(XFF 繞過)+ High(額度 TOCTOU)+ Medium(無 rate limit)+ Medium(額度只 prod 強制)四條串起來 = 未認證者單機可無上限觸發付費 Azure 合成。優先級最高。

**高信心 bug(雙重獨立確認):** 非 BMP 字元 UTF-16 offset 高亮錯位 —— 稽核條與 TTS-Deep 條各自抓到同一處(`src/tts/azure-synthesize.ts` + `azure-normalize.ts`)。

## 🔴 Critical(1)

### Critical-1 [security] Guest 每日額度可被 X-Forwarded-For 偽造完全繞過 → 無上限觸發付費 Azure 合成

- **位置:** `lib/auth.ts:92-102`  ·  **反證票:** 3/3
- **問題:** Guest 身分以 client IP 的 sha256 當 identity(guestAuth),而 IP 取自 clientIp():直接讀 req.headers.get("x-forwarded-for") 的第一個逗號片段,完全信任 client 送的標頭,專案內無 middleware、無 trusted-proxy 正規化(grep 確認 middleware.ts 不存在)。額度表 tts_usage 以 identity 為主鍵計數(db/schema/tts-usage.ts),而 guest identity = guest:<hash(XFF 第一段)>。攻擊情境:未登入攻擊者對 GET /api/tts/ttkan/<slug>/<idx> 每次帶不同 X-Forwarded-For(如 1.0.0.1、1.0.0.2…),每個值都被算成全新 guest identity → 每個都拿到全新的 5 章額度(TTS_QUOTA_GUEST)。由於每次 cache miss 都真的送 Azure 付費合成(lib/tts.ts:208 synthesizeAndCache),這是一條未認證、可無限放大的『付費合成』成本/帳單 DoS。配合無任何 rate limit(見另一條),單機即可刷爆 Azure 配額與費用。lib/auth-server.ts:19 有同樣的 XFF 信任問題。
- **修法:** 不要信任原始 XFF。1) 在反向代理/Next 部署層設定 trusted proxy,僅採信『最後一跳代理寫入』的那一段 IP(取 XFF 由右往左、跳過已知代理),或改用平台提供的可信來源(如 Vercel 的 request.ip / x-vercel-forwarded-for)。2) guest 額度本質上以 client 可控值為 key,單靠 IP 不可靠;應對 guest 合成路徑加全域速率限制(見 rate-limit 條),並考慮對未登入者直接禁用付費合成或大幅收斂為極小、且以更難偽造的訊號(平台層 IP)計數。3) 把 IP 解析集中到單一 server-only helper,移除 lib/auth.ts 與 lib/auth-server.ts 重複且皆信任原始 XFF 的邏輯。

## 🟠 High(5)

### High-1 [security] 額度檢查 assert→consume 為 TOCTOU,跨並發不同章節可雙花/超量

- **位置:** `lib/tts-quota.ts:62-84`  ·  **反證票:** 3/3
- **問題:** assertQuota() 先 countToday() 讀目前用量、判斷 used>=limit 才丟錯,consumeQuota() 之後才以 onConflictDoUpdate(count+1) 落帳;兩步之間非原子。lib/tts.ts:207-216 的流程是『assertQuota → synthesizeAndCache(耗時數秒送 Azure) → consumeQuota』,而 in-flight 去重(lib/tts.ts:65,184)只對『相同 key(同 source|voice|slug|idx)』去重,不同章節/不同 voice 是各自獨立的 task。攻擊情境:member(額度 30)或被偽造的 guest 同時併發請求 N 個不同章節,全部在任何一次 consume 落帳前通過 assert(都讀到同一個舊 used 值),於是 N 次合成全部放行、合計遠超 limit。原始碼註解(lib/tts-quota.ts:71-73、lib/tts.ts:209)已自認此競態『單人規模可接受』,但結合上一條 XFF 繞過後,超量上限實質不可控,直接放大付費成本。consumeQuota 失敗時還被 try/catch 吞成 best-effort(lib/tts.ts:213),合成已發生卻可能完全不計額。
- **修法:** 把『檢查+扣減』併成單一原子操作。SQLite/Turso 可用一條條件式 upsert:INSERT … ON CONFLICT(identity,day) DO UPDATE SET count=count+1 WHERE tts_usage.count < :limit,再以 changes()/回傳列數判斷是否成功;扣減失敗(已達上限)才丟 QuotaError,且在『真正送 Azure 之前』就完成原子預扣(失敗再回補),而非合成後 best-effort 落帳。admin(Infinity)維持短路。如此可消除跨並發 TOCTOU,也讓 consume 失敗不再導致『免費合成』。

### High-2 [perf] loadChapters 對整本書 SELECT * 含 content,TTS 合成路徑每章重複載入整本內文(N×content over-fetch)

- **位置:** `lib/books.ts:42-44`  ·  **反證票:** 3/3
- **問題:** loadChapters 用 db.select().from(chapters) 即 SELECT *,把整本書每一章的 content 欄位(整章內文,ttkan 章節常數 KB~數十 KB)全部撈進記憶體。此函式被 getChapterView 與 getOrFetchBook 高頻呼叫:每次開章 SSR 走一次、每次 TTS 合成(getChapterAudioMeta→getChapterView)又走一次,而它們真正只需要 idx/title/sourceUrl/單一目標章的 content。一本 1000 章的書,每次只為了找 prevIdx/nextIdx/position 與一章內文,就要把 ~1000 章 content 全部反序列化進 Node heap。量級:單請求多載入 (N-1) 章內文,1000 章 ×~10KB ≈ 10MB/請求 的無謂記憶體 + 反序列化,且隨書變大線性惡化。getChapterView 內 rows.findIndex(c=>c.idx===idx) 也是 O(N) 線性掃描(line 150)。
- **修法:** 拆兩條查詢路徑:(1) 目錄/定位用 db.select({id,idx,title,sourceUrl}).from(chapters)(不取 content);(2) 目標章內文單獨 db.select({content}).where(eq(idx,idx)).limit(1)。prevIdx/nextIdx 可改用 SQL 直接查相鄰 idx(WHERE idx< target ORDER BY idx DESC LIMIT 1),position/total 用 COUNT,避免把整表載進來再算。listChapterRefs(line 177)同樣只需 idx+title 卻走 loadChapters 撈 content,一併改 projection。

### High-3 [perf] 全章 TTS 合成把整章 PCM 全積在記憶體再一次性 concat,長章記憶體尖峰可達數十 MB

- **位置:** `src/tts/azure-synthesize.ts:199-236`  ·  **反證票:** 3/3
- **問題:** synthesizeAzureChapter 把每段 PCM 推進 parts:Uint8Array[],全章合成完才 reduce 算 totalLen、new Uint8Array(totalLen)、逐段 merged.set 複製一次,再 pcmToWav 又 Buffer.concat([header, Buffer.from(pcm)]) 複製第二次。Raw24Khz16BitMonoPcm = 48 bytes/ms,一章 4500 字約 6-7 分鐘語音 ≈ 18-20MB PCM;合成瞬間記憶體同時持有 parts 全部分段 + merged 全章 + wav 全章 ≈ 3 份拷貝(~60MB)。admin 開章自動 prefetch 會對每個進章都觸發,若同時多章 inflight,Node heap 尖峰疊加。charBatches.flat()(line 241)也是再生一份全章 timestamp 陣列。量級:每長章合成瞬時 ~3× 全章音檔大小的 heap,prefetch 並發下成倍。
- **修法:** 合成完成後直接串流寫檔:用 fs.createWriteStream 先寫 44-byte header 再逐段 write(pcm),避免 merged 與 wav 兩份全章拷貝同時在 heap。durationMs 用累計 byteLength 即可(已在算 cumulativeMs)。若維持現狀,至少把 pcmToWav 改成直接寫 header+parts 而非先 merge 再 concat,省一份拷貝。

### High-4 [overeng] 投機性 TTS provider 抽象層:整套換源契約只被測試撐著,production 從未使用

- **位置:** `src/tts/types.ts:12-72, 102-110`  ·  **反證票:** 3/3
- **問題:** ChapterAudio、SynthesizeInput、AudioSourceProvider、ChapterAudioMeta、TtsEngine 這整組「換音源(Azure→IQT→Eleven)只換一個檔」的抽象,在 src/lib/components/app 全域只有 src/tts/index.ts barrel 轉出、以及 tests/tts/contract.test.ts 拿一個 fake provider 去驗它 —— 沒有任何一行 production code 實作 AudioSourceProvider 或回傳 ChapterAudio/ChapterAudioMeta。真正跑的路徑是 azure-synthesize.ts 的 AzureChapterResult + lib/tts.ts 的 ChapterAudioFile,兩者各自定義形狀,根本不經過這層契約。這是典型『為了以後也許要換源』的 YAGNI scaffolding:目前只有一個實作(Azure),抽象帶來的只有兩套平行型別(契約 vs 實際)+ 一隻只測抽象自己的 contract.test.ts。runtime 真正需要的只有 CharTimestamp、TimestampsPayload、AzureBoundary 三個。
- **修法:** 刪掉 ChapterAudio、SynthesizeInput、AudioSourceProvider、ChapterAudioMeta 與 TtsEngine,連同 src/tts/index.ts 對它們的 re-export 與 tests/tts/contract.test.ts。types.ts 只留 CharTimestamp / TimestampsPayload / AzureBoundary。等真的要接第二個音源時再長出抽象(屆時有兩個實作,抽象才有意義)。省約 50 行型別 + 整支 contract.test.ts(~55 行) + barrel 約 8 行。

### High-5 [tts-pipeline] Azure textOffset 是 UTF-16 code-unit offset,但 charIndex/cpStart/渲染端用 code-point index —— 章內出現任一非 BMP 字會讓其後全部高亮平移錯位

- **位置:** `src/tts/azure-synthesize.ts:108-113,219`  ·  **反證票:** 3/3
- **問題:** 整條高亮對齊的鐵則是『charIndex 落在 [...plainText] 的 code-point 索引空間』(types.ts:21-32、azure-synthesize.ts:179-181)。但 e.textOffset 並非 code-point offset:Azure SDK 內部以 `this.privRawText.indexOf(text, ...)` 計算 textOffset(node_modules/microsoft-cognitiveservices-speech-sdk/.../SynthesisTurn.js:253),JS String.indexOf 回傳的是 UTF-16 code-unit 位置,wordLength/text.length 也是 UTF-16 長度。azure-normalize.ts:44 直接 `charIndex = b.textOffset - offsetBase + k`,offsetBase=-cpStart 為 code-point 值,於是把 UTF-16 offset 當 code-point offset 相加。

後果:章節純文字在某 chunk 內若出現一個非 BMP 字(CJK 擴充 B 以上的罕用字如 𠀀,或 emoji,各佔 2 個 UTF-16 unit),其『之後』所有 word boundary 的 textOffset 會比真正 code-point index 多 1(每個 surrogate pair +1)。經 `textOffset + cpStart + k` 還原後,該 chunk 內後續每個字的 charIndex 全部 +1,高亮整段往後偏一格(標點 gap 也跟著錯位),且偏移會累積。chunk.ts:39 與 use-tts-highlight 渲染端(use-tts-highlight.ts:10-12 註解的 `[...content]` code-point 編號)都正確用 code-point,唯獨 boundary offset 是 UTF-16 —— 三方索引空間在含非 BMP 字時不一致。

注意 azure-normalize.test.ts『code-point 切字』案例只驗了 b.text 內部用 [...] 切(正確),沒驗『非 BMP 字出現在某詞之前時 textOffset 仍對齊』,故此漏洞未被測試攔到。中文小說正文確實可能含 CJK Ext-B 人名/生僻字。
- **修法:** 在 synthesizeSegment 收 boundary 時,把 UTF-16 textOffset 轉成 code-point offset 再往下傳。最穩的做法:對每段 chunk.text 預先建一張 utf16Index→codePointIndex 對照(掃一次 [...chunk.text] 累加各字的 .length),於 wordBoundary callback 用 `cpOffset = map[e.textOffset]` 取代原始值;wordLength 也同理用 [...slice].length。或在 azureWordsToChars 改以 b.text 在原文的 code-point 位置重新定位。並補一個『chunk 內含 surrogate pair 字、其後詞 charIndex 仍對齊』的整合測試。

## 🟡 Medium(4)

### Medium-1 [security] 全站無速率限制:/unlock 兌換與 TTS 合成路徑皆可被高頻濫用(暴力/成本 DoS)

- **位置:** `app/unlock/actions.ts:19-44`  ·  **反證票:** 3/3
- **問題:** grep 確認專案無任何 rate limiting,也無 middleware.ts。redeemCodeAction 對每次 POST 都會走 redeemCode → 比對 ADMIN_CODES 並查 DB(lib/auth.ts:134-151),沒有任何嘗試次數限制或退避;雖然邀請碼有 144-bit 熵(scripts/gen-access-code.ts:17 randomBytes(18))使線上猜碼不可行,但缺乏節流仍構成 DB 壓力/枚舉嘗試的放大面。更關鍵的是 TTS 兩條 route(app/api/tts/.../route.ts、.../timestamps/route.ts)亦無速率限制,cache miss 即觸發付費 Azure 合成,結合上面兩條(XFF 偽造 + TOCTOU)讓成本型 DoS 變得簡單且高效。
- **修法:** 在 TTS route 與 /unlock action 加全域速率限制(以可信來源 IP + identity 為 key),例如 token-bucket / 固定視窗;Next 可用輕量 in-memory limiter(單機)或外部 KV(多實例)。對 /unlock 兌換失敗加指數退避與每 IP/每 session 上限。對 TTS 合成另設『每身分每分鐘新合成次數』上限,作為額度之外的第二道閘,避免單身分在重置前突刺刷量。

### Medium-2 [security] 額度僅在 NODE_ENV===production 強制:任何 preview/staging 部署對外免費供應付費合成

- **位置:** `lib/tts-quota.ts:38-46`  ·  **反證票:** 3/3
- **問題:** quotaEnforced() 只在 NODE_ENV==="production"(或顯式 TTS_ENFORCE_QUOTA=1)回 true;lib/tts.ts:205-216 據此決定是否 assert/consume 額度。攻擊情境:任何以非 production 模式對公網開放的部署(常見的 preview/staging/預覽網址、或誤用 next start 但 NODE_ENV 非 production 的環境)會對所有人(含 guest)無上限放行付費 Azure 合成,完全不計額。聽書 route 不需登入即可命中,因此一旦這類環境曝光於公網,等同免費代刷 Azure 帳單。設計意圖是『本機與測試免設定』,但用 NODE_ENV 當開關使得『非 prod 即無防護』的範圍超出本機。
- **修法:** 把『放行額度』的條件由『預設放行、僅 prod 強制』反轉為『預設強制、僅顯式 opt-out』:例如 quotaEnforced() 預設 true,只有在偵測到本機(NODE_ENV==="test" 或顯式 TTS_DISABLE_QUOTA=1)才放行;讓任何未明確關閉的部署都受額度保護。並確認所有對外可達的非 prod 環境要嘛關閉 TTS,要嘛強制額度。

### Medium-3 [perf] audio-player 換速 setRateIdx 觸發整個 506 行元件 re-render,且 PLAYBACK_RATES.map 重建 5 個 PopoverClose+button

- **位置:** `components/reader/audio-player.tsx:120,422-443`  ·  **反證票:** 3/3
- **問題:** rateIdx 為 useState,handleRateSelect 既設 audio.playbackRate(imperative 已足夠生效)又 setRateIdx 觸發 re-render。每次 timeupdate(~4Hz)也 setPositionMs 觸發 re-render,playing 時每秒約 4 次重渲染整個 player(含 createPortal 子樹、Popover、進度 input、PLAYBACK_RATES.map 重建 5 個 button)。雖然高亮已正確分離走 DOM,但 player 自身 first-row 控制列每秒重渲染 4 次仍是可省的工作。PLAYBACK_RATES.map 的 5 個 PopoverClose 在每次 re-render 都重建(Popover 即使收合也在樹中)。量級:playing 全程 ~4 renders/s × 整個 portal 子樹 diff;非致命但持續。
- **修法:** 把進度顯示(formatTime + input value)抽成獨立子元件,只讓它吃 positionMs,隔離高頻 setPositionMs 不波及控制列/Popover。或進度條改純 imperative(用 ref 直接設 input.value 與時間 span 的 textContent),完全不走 state,與高亮同模式。rate dropdown 內容用 useMemo 或抽成只吃 rateIdx 的子元件。

### Medium-4 [style] synthesizeAzureChapter 函式 >50 行(全域 <50 行規範)

- **位置:** `src/tts/azure-synthesize.ts:185-244`  ·  **反證票:** 3/3
- **問題:** 函式本體約 60 行(185-244),超過全域 coding-style「Functions are small (<50 lines)」上限。內含三段可清楚分離的職責:(1) env 驗證、(2) for-loop 逐段合成 + 累積 charBatches/parts/cumulativeMs、(3) PCM 串接(229-236 的 totalLen/merged/off 手動拼接)。第三段尤其是獨立純邏輯,留在主函式只是拉長行數。
- **修法:** 把 PCM 串接抽成 `concatPcm(parts: readonly Uint8Array[]): Uint8Array`(229-236),逐段合成迴圈抽成 `synthesizeChunks(chunks, key, region, voice): { parts, charBatches, durationMs }`。主函式縮成 env 驗證 + 兩個呼叫 + WAV 封裝,降到 <30 行,且 concatPcm 可單測。

## ⚪ Low(10)

### Low-1 [bugs] countToday/today() 用 UTC 切日,但 Retry-After 固定 3600 與額度語意不一致,且跨時區使用者午夜前後額度看似亂跳

- **位置:** `lib/tts-quota.ts:49-51`  ·  **反證票:** 3/3
- **問題:** today() 用 new Date().toISOString().slice(0,10) 取 UTC 日期。台灣使用者(UTC+8)在當地 08:00 才跨 UTC 日界,等於「台灣早上 8 點」才重置額度,而非當地午夜。對台灣繁中小說讀者而言「今日額度」會在早上 8 點突然回滿、晚上 8 點(UTC 12:00 隔日)之類的時點與直覺不符。route 回的 Retry-After:3600(1 小時)更是與「跨日才重置」完全脫鉤 —— 真正能再用的時間是「下一個 UTC 午夜」,可能還有十幾小時,卻叫 client 1 小時後重試,重試必再 429。
- **修法:** 若要對齊使用者直覺,today() 改用固定 APP_TZ(如 Asia/Taipei)的當地日期切分(Intl.DateTimeFormat with timeZone);Retry-After 改為動態計算到下一個重置時點的秒數,而非寫死 3600。至少把 3600 註記為「粗略提示、非保證」。

### Low-2 [security] session HMAC 在無 SESSION_SECRET 時於非 prod 退回固定弱密鑰

- **位置:** `lib/auth.ts:38-46`  ·  **反證票:** 2/3
- **問題:** secret() 在 production 未設 SESSION_SECRET 會 throw(正確),但非 production 退回硬編 'dev-insecure-secret-change-me'。任何以非 production 模式對外可達的環境(同上 NODE_ENV 風險)會用此公開已知密鑰簽 session,攻擊者可離線偽造 {role:"admin",...} 的合法 cookie(signSession 邏輯在原始碼可見),取得 admin(Infinity 額度、繞過所有額度)。在純本機開發無實害,但與『非 prod 即對外』疊加時成為提權路徑。
- **修法:** 至少要求所有對外部署都設定 SESSION_SECRET;可把 throw 條件由『僅 production』放寬為『非顯式本機/測試一律要求』(與 quotaEnforced 反轉同思路)。或在退回 dev 密鑰時於啟動日誌明顯警告,並確保預覽/測試環境不曝露於公網。

### Low-3 [perf] reader-view 的 onScroll 每次 scroll 事件都重設 800ms debounce timer,捲動中持續 clearTimeout/setTimeout

- **位置:** `components/reader/reader-view.tsx:143-169`  ·  **反證票:** 2/3
- **問題:** onScroll 雖用 rafPending 對 setScrollPct 做了 rAF 節流(正確),但 debounce 存進度部分每個原生 scroll 事件(可達 60-100 次/秒)都無條件 clearTimeout(saveTimer)+setTimeout(flushProgress,800)。快速捲動長章時這是每秒上百次的 timer 重建。雖單次成本低,但屬可避免的持續工作,且與已做好的 rAF 節流不一致。量級:捲動期間 ~60-100 timer churn/s,輕微。
- **修法:** 把 debounce 重設也併進 rafPending 那條節流分支內(rAF callback 內才 clear+set timer),或改用單一 leading+trailing 節流。讓兩個副作用共用同一個節流閘門。

### Low-4 [perf] ttkan parseContent 對整章文字逐行 split→trim→4×filter→join,大章多次全量走訪 + 中間陣列

- **位置:** `src/sources/ttkan.ts:106-118`  ·  **反證票:** 2/3
- **問題:** parseContent 先 cheerio.load 整頁(必要),再對 $content.text() 做 split('\n') 產生行陣列,接著 map(trim) + 連續 4 個 .filter(各自全掃一遍並生成新陣列)+ join。一章數千行時是 1(map)+4(filter)= 5 趟全量走訪 + 5 個中間陣列。每章只在首次抓取走一次(之後 DB 快取),非熱路徑,但屬可合併的字串處理。量級:首抓單章 5× 行數的走訪 + 中間陣列;低頻。
- **修法:** 合併成單趟 reduce/for 迴圈:逐行 trim 後用一組合併的正則或單一 if 判斷是否丟棄,通過則 push,最後一次 join。把 4 個 filter 的正則合成一個 /天天看小說|請記住本站|ttkan|章節報錯|分享給朋友/i 與 /^=+$/ 的 OR 判斷。

### Low-5 [perf] listLibrary 用 COALESCE(updatedAt, addedAt) 排序無對應索引,書架變大時退化為全表掃描+排序

- **位置:** `lib/library.ts:49-67`  ·  **反證票:** 3/3
- **問題:** listLibrary 三表 join(library innerJoin books, leftJoin progress, leftJoin chapters) 後 orderBy desc(COALESCE(progress.updatedAt, library.addedAt))。COALESCE 表達式無法用任何單欄索引,SQLite 必須物化結果集後 filesort。progress/library 雖有 (userId,bookId) unique index 支撐 join 與 WHERE,但最終排序鍵是跨表 COALESCE,無索引可用。MVP 單使用者書架小(數十本)無感,但語意上是會隨書架線性惡化的 sort。量級:書架 K 本 → O(K log K) filesort,K 小可忽略,留意未來多使用者。
- **修法:** 目前規模 YAGNI,可不動。若日後書架變大:在 progress 增 updatedAt 索引並改以 progress 為驅動表分頁,或在 library 冗餘一個 lastReadAt 欄位(寫進度時同步更新)直接索引排序,免 COALESCE。

### Low-6 [overeng] whenSeekable:手寫一次性事件等待,可用 audio 既有 readyState 輪替或直接設值

- **位置:** `components/reader/audio-player.tsx:72-81`  ·  **反證票:** 3/3
- **問題:** whenSeekable 包了一個 Promise 等 loadedmetadata。但本檔 ensureLoaded 在設 audio.src 後是緊接設 currentTime 的同一條路徑用得到它;然而 ensureLoaded 設完 src 後並沒有等 metadata(它依賴 server 已合成完音檔秒回 + preload=metadata),只有 seekAndPlayToChar 用到。這個 10 行 helper 解的是真實 race(readyState=0 時設 currentTime 被打回 0),保留有理由,但可縮短:loadedmetadata 是 once 事件,用 { once: true } 省掉手動 removeEventListener。
- **修法:** 用 addEventListener("loadedmetadata", resolve, { once: true }) 取代手寫 on + removeEventListener,helper 從 10 行縮到 4 行。屬可選清理,非必砍。

### Low-7 [tts-pipeline] durationMs=0 的多字 word 產生 startMs===endMs 的零寬字,seek 到它時與相鄰字無法區分(刻意行為但無下界保護)

- **位置:** `src/tts/azure-normalize.ts:39-48`  ·  **反證票:** 3/3
- **問題:** per = b.durationMs/chars.length;durationMs=0 → per=0 → 該詞每字 startMs===endMs(azure-normalize.test.ts『退化』案例釘住此為刻意行為)。這保留了 charIndex 完整性(好),但這些零寬字在 activeCharIndex 的 binary search 中『最後一個 startMs<=currentMs』語意下會被同 startMs 的後續字蓋過 —— 多個字共用同一 startMs 時 activeCharIndex 回傳最後一個(sync.ts:30-31 `<=` 取 mid+1),高亮會直接跳到該批最後一字,中間字永遠不會單獨高亮。對 Azure 正常輸出極少觸發,但若整章某詞回 durationMs=0(SDK 偶發),該詞除末字外都無法高亮。
- **修法:** 非緊急。若要修,可在 azureWordsToChars 對 per===0 的多字詞給每字一個極小遞增 epsilon(如 +k 毫秒)使 startMs 嚴格遞增,維持每字可被 binary search 命中;或在文件明確標註此為已知退化(目前 normalize 的 doc 已提但未說明對 highlight 的後果)。

### Low-8 [tts-pipeline] 並發下兩章可各自通過 assertQuota 再各自 consumeQuota,額度可被超用;且 consumeQuota 失敗時合成已寫快取卻不計費(設計已知,但與 prefetch 疊加放大)

- **位置:** `lib/tts-quota.ts:62-84`  ·  **反證票:** 3/3
- **問題:** assertQuota(讀 count) 與 consumeQuota(+1) 非原子(quota.ts:73-74 的 ponytail 註解已自認)。getChapterAudioMeta 的 inflight 去重(lib/tts.ts:65,184-185)只去重『同一 key』,不同章 key 不同,故 member 同時開兩章(或 audio+timestamps 兩 route 對同章雖共用 inflight、但跨章不共用)可在 limit 邊界各過一次 assert 再各 +1,超用 1 次。此外 consumeQuota 失敗只 warn(lib/tts.ts:210-216),該次合成不計費 —— 雖是 best-effort 設計,但 admin prefetch 不受影響,member 在 DB 抖動時可無限免費合成。規模小可接受,但屬『額度計算與實際合成不一致』類。
- **修法:** 如需硬上限,把 assert+consume 併成單條原子 UPDATE:`UPDATE tts_usage SET count=count+1 WHERE identity=? AND day=? AND count<limit`(配合 insert ... on conflict),用 affected rows 判斷是否超額,超額則 rollback/不落地。consumeQuota 失敗時可考慮在 audio route 回特定標記讓 client 知道本次未計;目前行為符合註解所述取捨,僅標記為已知缺口。

### Low-9 [style] backoffDelayMs 退避基數與倍率半硬編

- **位置:** `src/tts/azure-synthesize.ts:28-30`  ·  **反證票:** 2/3
- **問題:** `RETRY_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * RETRY_BASE_MS)` 中,指數底數 `2` 為內聯魔術數字。RETRY_BASE_MS/MAX_ATTEMPTS 已抽成具名常數(20-21),唯獨倍率 2 直接寫死。對照『No hardcoded values (use constants or config)』,屬輕微不一致。
- **修法:** 抽 `const BACKOFF_FACTOR = 2;` 並改為 `RETRY_BASE_MS * BACKOFF_FACTOR ** (attempt - 1) + ...`,與既有具名常數風格一致,日後要調退避曲線只改一處。

### Low-10 [style] audio-player 錯誤提示文案為內聯硬編字串

- **位置:** `components/reader/audio-player.tsx:212, 238, 264, 291, 344`  ·  **反證票:** 3/3
- **問題:** 多處使用者面錯誤/提示文案直接內聯:『今日聽書額度已用完,請解鎖或明日再試。』(212)、『聽書合成失敗,請稍後再試。』(238)、『播放失敗,請再試一次。』(264/291/344 重複三次)。對照『No hardcoded values』與『many small files / 高內聚』,重複文案散落且難一致維護;『播放失敗』完全相同字串出現三次。
- **修法:** 抽一個 `const TTS_MESSAGES = { synthFailed, playFailed, quotaExhausted } as const;`(或既有 i18n 機制)集中管理。三處相同的 catch『播放失敗』可共用同一常數,降低漂移風險。

## 被反證砍掉的(抽樣,不採信)

- ✗ 429 額度回應在已 abort(換章/卸載)後仍 setState,且永久卡住 loadedRef (`components/reader/audio-player.tsx`) — 僅 1 票
- ✗ 快取命中時跳過額度,但首呼是 timestamps route → 偵測快取後 audio route 仍可能各自合成造成雙重計額/雙重合成 (`lib/tts.ts`) — 僅 0 票
- ✗ azureWordsToChars 對 durationMs=0 的瞬時詞產生 startMs===下一詞 startMs,破壞 activeCharIndex 的嚴格遞增前置條件邊界 (`src/tts/azure-normalize.ts`) — 僅 0 票
- ✗ getChapterView:本地書(無 adapter)章節目錄為空時不重抓,findIndex 直接拋『找不到章節』而非更明確錯誤 (`lib/books.ts`) — 僅 0 票
- ✗ 無 Range 的整檔回應對 0-length / header-only WAV 設 Content-Length 但 createReadStream 對應正常;真正風險是並發整檔串流無背壓上限 (`app/api/tts/[bookSource]/[id]/[idx]/route.ts`) — 僅 0 票
- ✗ redeemCode 對 member 碼以明文 trim 後 hashCode 查 DB,但 admin 比對在前且用 safeEqual 長度不同直接 false,環境變數含空白碼會永遠比不中 (`lib/auth.ts`) — 僅 0 票
- ✗ consumeQuota 並發超量(已知)在 member 邊界可被放大:assertQuota 與 consumeQuota 非原子 (`lib/tts-quota.ts`) — 僅 0 票
- ✗ chapter-list.tsx 視窗分頁:winStart 越界後 fallback 到 0,但 useEffect 重置與 render 期讀取存在一幀錯位;且空 filtered 時 jump-pad 計算會讀 filtered[s].idx 但 windowed 已守門 (`components/chapter-list.tsx`) — 僅 0 票
- ✗ pruneCache 對『正在被 inflight 寫入/讀取的當前章』可能誤砍,造成 audio route stat/read 落空 → 500 (`lib/tts-cache.ts`) — 僅 0 票
- ✗ whenSeekable 監聽 loadedmetadata 永不 resolve 的洩漏:src 設定失敗或換章時無 timeout/abort (`components/reader/audio-player.tsx`) — 僅 0 票

## TTS-Deep 深查(3 路,均成功)

### TTS-1 pipeline 端到端正確性

Deep end-to-end trace of Koma TTS pipeline (chunk to Azure synth to PCM stitch to char timestamps to route to frontend highlight). The design is solid: cross-segment duration accumulates only from PCM bytes never boundary ms (correct); chunkContent is round-trip lossless; the -cpStart sign overload is correct and test-guarded; index space (reader-content [...content] code-point vs pipeline charIndex) aligns exactly for BMP text; all 70 existing tests pass. Found one empirically-confirmed correctness bug plus several robustness/consistency gaps. Highest priority: Azure SDK wordBoundary.textOffset is a UTF-16 code-unit offset (SDK computes it via privRawText.indexOf(text)+text.length), yet the pipeline treats it as a code-point index and mixes it with cpStart (from [...content]) and k (from [...b.text]). Pure-BMP Chinese is unaffected (tests and normal novels pass), but any non-BMP code point (CJK Ext-B, emoji) before a word boundary inside a chunk shifts charIndex for every following char in that chunk and breaks highlight alignment. Confirmed with a probe test mirroring SDK indexOf semantics: a char whose true code-point index is 3 got charIndex 4. Secondary: azureWordsToChars lacks defensive validation for textOffset<0 / out-of-range charIndex; both audio and timestamps routes are cached immutable for a year with no textHash busting (content re-fetch can desync them); the tts-cache capacity estimate treats uncompressed PCM WAV as if compressed (real size 3-4x larger, hot cache holds ~1/4 the documented chapters); WAV header writeUInt32LE has no upper guard (not practically reachable); UTC daily quota reset lands at 8am local for a Taiwan-first app.

| 嚴重度 | 問題 | 位置 |
|---|---|---|
| high | Non-BMP chars misalign segment highlight: Azure textOffset is UTF-16 code-unit but pipeline treats it as code-point | `src/tts/azure-normalize.ts:44 and src/tts/azure-synthesize.ts:219` |
| medium | azureWordsToChars has no defensive validation for textOffset<0 or out-of-range charIndex | `src/tts/azure-normalize.ts:29-49` |
| medium | audio and timestamps routes cached immutable for a year with no textHash busting; content re-fetch can desync them | `app/api/tts/[bookSource]/[id]/[idx]/route.ts:21,95,110 and timestamps/route.ts:34; urls.ts:8-27` |
| medium | tts-cache capacity estimate treats PCM WAV as compressed; real size 3-4x larger, hot cache holds ~1/4 documented chapters | `lib/tts-cache.ts:23` |
| low | WAV header writeUInt32LE has no upper guard for very long chapters (theoretical overflow, not reachable) | `src/tts/azure-synthesize.ts:61,72` |
| low | Daily quota resets at UTC midnight = 8am local for a Taiwan-first app (undocumented) | `lib/tts-quota.ts:49-51` |
| low | Per-char endMs and chapter durationMs come from independent sources; last char endMs can exceed durationMs | `src/tts/azure-synthesize.ts:239 vs azure-normalize.ts:46` |

**建議:**
- Top priority: fix the UTF-16 vs code-point mixing for textOffset. At the azureWordsToChars entry (or when collecting wordBoundary in synthesizeSegment), convert the UTF-16 textOffset to a code-point offset within the chunk text (count code points of chunkText.slice(0, e.textOffset)) before adding -offsetBase. Update the code-point-semantics comments in types.ts:82 and azure-normalize.ts.
- Add a non-BMP end-to-end alignment test (e.g. a U+20000 char) using fake boundaries that mirror the SDK indexOf/UTF-16 semantics, locking in that charIndex for chars after a non-BMP char still aligns to the [...content] code-point index.
- Add defensive validation: filter boundaries with textOffset<0 (log a warning) and, at the end of synthesizeAzureChapter, assert final charIndex values are in [0, codePointLen) and startMs is non-decreasing, logging anomalies server-side.
- Add content-fingerprint busting to the audio/timestamps URLs (?v=first 8 chars of textHash injected by the server at page render), or downgrade Cache-Control from immutable to a shorter max-age with must-revalidate, to eliminate post-re-fetch desync and stale client/CDN copies.
- Correct the lib/tts-cache.ts:23 capacity comment to PCM-real values (~21-48MB/chapter, 1GB approx 20-40 chapters); if storage cost matters, evaluate a compressed output format to fit several times more chapters per GB after confirming Range seek and wordBoundary still work.
- Low-risk hardening: assert a sane upper bound on total merged PCM byteLength before pcmToWav (fail fast over an obscure RangeError); clamp charTimestamps startMs/endMs to [0, durationMs]; compute the quota day key in Asia/Taipei or explicitly document UTC rollover = 08:00 Taiwan reset.

### TTS-2 字級 timestamp 落地方案

字級 timestamp 已不是「未驗證未知數」——blackCat 已實作並驗證了「兩條都通」的路。本次任務是評估與給落地建議,而非從零探路。實況: (1) 路線 A「Azure 詞級 boundary → 依字數均分到字級」已在 production 管線跑通 (src/tts/azure-synthesize.ts + azure-normalize.ts),配 stitch/sync/use-tts-highlight 整條閉環。(2) 路線 B「對 TTS 音檔 + 原文做 forced alignment」POC 也於 2026-06-17 真打通過 (scripts/forced-align-poc.py,torchaudio.forced_align + 中文 CTC 模型,字典即漢字 → 天生字級)。

WebSearch + Microsoft 官方文件查證確認三件事: (A) Azure Neural TTS 的 WordBoundary 對中文【落詞級非字級】是官方一貫行為,wordLength 計入「字數」,中文詞 (如 夜色/毫無) 會回 wordLength=2 一筆 boundary,單字詞才 =1。這正是 spike-tts-azure 實測 (9 筆 boundary)、也是現行 azureWordsToChars 均分邏輯的依據。(B) textOffset/wordLength 是 UTF-16-based 的 offset,而非 code-point;codebase 已用 [...text] code-point 切 + -cpStart sign overload 正確處理 surrogate pair 與 SSML-relative offset。(C) 一個尚未釋出 (狀態 accepted/to-be-released) 的 SDK bug:`<`、`>`、`&` 三個字元會讓 WordBoundary 從該字元之後開始錯位;官方 workaround 正是用 speakTextAsync (純文字) 而非 speakSsmlAsync——而 azure-synthesize.ts 正好用 speakTextAsync,spike 才用 speakSsmlAsync。

推薦方案: 維持現狀分工。Azure provider 繼續用「詞級 boundary + 均分」當暫代/現行唯一已驗證可逐字高亮的音源 (sync.ts/azure-normalize.ts 不需改);換自家 IQT 時走 forced alignment 取得真字級 (POC 已驗,工程化為預合成一步即可)。sync.ts 本身 (activeCharIndex binary search) 是 provider-agnostic,兩條路都不需動它——真正的「整合點」是 provider 內部 timing 來源,而非 sync.ts。下方 issues 為落地前需收尾的具體缺口與風險,recommendations 為排序後的行動項。

| 嚴重度 | 問題 | 位置 |
|---|---|---|
| high | forced-align-poc.py 仍是 POC,尚未工程化成可被 IQT provider 呼叫的管線步驟 | `scripts/forced-align-poc.py` |
| medium | Azure SDK 對 `<` `>` `&` 的 WordBoundary 錯位 bug——現行碼幸運避開,但 SSML spike 路徑暴露 | `src/tts/azure-synthesize.ts:116 (speakTextAsync) vs scripts/spike-tts-azure.ts:107 (speakSsmlAsync)` |
| medium | 詞→字均分對 3 字以上詞或長停頓詞的字級精度誤差,缺少上界量測 | `src/tts/azure-normalize.ts:39-48` |
| low | 末字 endMs 可能延伸過長 / 詞間 gap 期間高亮停滯——已知行為但跨 provider 不一致 | `src/tts/azure-normalize.ts:44-47 與 scripts/forced-align-poc.py:113-120` |
| low | forced-align 依賴鏈鎖死於舊版 (Python 3.9 + torch 2.2.2 + torchaudio.forced_align 將在 2.9 移除) | `docs/meta/plans/04-stage3-tts-pipeline.md:191 (環境鎖定說明) 與 scripts/forced-align-poc.py:11-15` |
| low | Azure region/voice 與台灣繁中音色的字級行為未對 zh-TW 複驗 | `scripts/spike-tts-azure.ts:36 (VOICE = zh-CN-XiaoxiaoNeural)` |

**建議:**
- 採『雙 provider、各取最佳 timing 來源』為落地方案,不要二選一: Azure provider 維持『詞級 boundary + 依字數均分』(現行已通、唯一已驗證可逐字高亮的暫代音源);IQT provider 走 forced alignment 取真字級。兩者共用 types.ts 的 CharTimestamp / AudioSourceProvider 契約,sync.ts (activeCharIndex) 完全不動——它是 provider-agnostic,本身無需任何改動。
- sync.ts 不是整合點,別動它。真正的整合點是『provider 內部 timing 從哪來』: Azure 路 = azure-synthesize.ts 收 wordBoundary → azureWordsToChars 均分 (已實作);IQT 路 = 新增 src/tts/iqt-synthesize.ts (或 iqt-provider),內部呼叫 forced-alignment,輸出同樣的 CharTimestamp[]。把 forced-align-poc.py 從 scripts/ 工程化:包成預合成批次一步 (WAV+章節純文字 → char timestamps JSON → 寫 tts-cache),用 child_process 或獨立容器服務暴露給 Node 端。
- 把 forced-alignment 的 Python/torch 子系統容器化隔離 (Docker),避免鎖死舊版 torch (2.2.2,且 forced_align 將於 torchaudio 2.9 移除) 與 Python 3.9 污染主應用。預合成本就是離線批次,容器化吸收這條技術債最乾淨;CI 只需在預合成 worker 跑,不進主 Next.js build。
- 落地前對真實繁體長章做一次量測 spike,補齊三個未驗數據: (1) 用 production 音色 zh-TW-HsiaoChenNeural 複跑,確認 zh-TW 下 wordLength 分佈與 charIndex 對齊同 zh-CN;(2) 統計 wordLength 直方圖 (尤其 ≥3 字詞佔比) 與最壞字級偏移,確認均分誤差在長詞處仍視覺無感;(3) 對照 forced-align 在同章同音檔的字級結果,量兩條路的字級偏差,作為換源回歸基準。
- 對 Azure SDK 的 `<`/`>`/`&` WordBoundary 錯位 bug (官方 issue #2359,to-be-released) 做防禦: 確保 production 永遠走 speakTextAsync (現行 azure-synthesize.ts 已是,維持住、別改成 SSML 路徑);若未來需 SSML (語速/停頓標記),在送字前對這三字元轉義並加註解,否則整段 charIndex 會從該字起全錯位且極難查。在 chunk/清洗階段對裸 `&<>` 記一個已知限制或做 sanitize。
- 統一兩 provider 的『字 active 區間』語意以求換源時高亮手感一致: 在 azure-normalize.ts 補 plan §156 已提的優化——把每個詞末字的 endMs 補到下一個 Word boundary 的 startMs (吃掉詞間 gap),使 Azure 路與 forced-align 路 (本就連續到下一字 onset) 行為對齊。activeCharIndex 不受影響 (只看 startMs),屬純化高亮體驗的低風險改動。
- 把本評估結論回寫 plan: 04-stage3-tts-pipeline.md 已正確記錄兩條路皆驗證 (§2.1 / §2.2.1),但可在風險表補上『Azure SDK 特殊字元 boundary bug』與『zh-TW 音色字級未複驗』兩條;memory 的 blackcat-tts-todo.md 把『字級 timestamp spike (最高槓桿前置項)』狀態由『待驗』更新為『已驗證、進入工程化階段』,避免後續 session 重複當未知數探索。

### TTS-3 player + 逐字高亮同步

深查 Koma TTS 播放器與逐字高亮同步。整體架構穩健,但在 seek/換章/暫停邊界與 rAF loop 找到數個真實缺口,最關鍵是 auto-scroll 的 smooth 捲動未尊重 prefers-reduced-motion。

| 嚴重度 | 問題 | 位置 |
|---|---|---|
| high | auto-scroll smooth 未尊重 prefers-reduced-motion | `components/reader/use-tts-highlight.ts:71` |
| medium | iOS 舊版變速變調缺 webkitPreservesPitch 前綴 | `components/reader/audio-player.tsx:226,355` |
| medium | prefetch 與按播放重疊吞掉播放意圖 | `components/reader/audio-player.tsx:185,253,303` |
| medium | 點字 seek 用 chars.find 線性掃描 O(n) 與 sync.ts 契約不一致 | `components/reader/audio-player.tsx:277-278` |
| medium | handleSeek 未經 whenSeekable 守門可能被打回 0 | `components/reader/audio-player.tsx:361-371` |
| medium | onEnded 不歸位 positionMs | `components/reader/audio-player.tsx:143-147` |
| low | 缺 visibilitychange 校正 iOS 背景狀態漂移 | `components/reader/use-tts-highlight.ts:106-112` |
| low | 卸載 abort 與 fetch resolve 競態無實害 | `components/reader/audio-player.tsx:218-223` |
| low | activeCharIndex 不看 endMs 致高亮滯留 | `src/tts/sync.ts:20-37` |
| low | lastActiveRef 對 DOM 強引用未隨 setChars 釋放 | `components/reader/use-tts-highlight.ts:58,119` |

**建議:**
- 修 HIGH:use-tts-highlight.ts:71 scrollIntoView 依 prefers-reduced-motion 切 behavior reduce 改 auto
- iOS 補 webkitPreservesPitch 前綴 fallback audio-player.tsx:226,355
- prefetch 與按播放重疊時 queue 播放意圖 ready 後自動續播
- 點字 seek 改 binary search 與 sync.ts 一致抽 firstCharAtOrAfter
- handleSeek 共用 whenSeekable 守門;onEnded 設 positionMs 為 durationMs
- 加 visibilitychange 校正 iOS 背景狀態;setChars 時清 lastActiveRef
- 收斂 ensureLoaded 的 abort 檢查窗口前移到 res.json 之前

## Evidence-check(5 決策 × 4 維)— ⚠️ 本次失敗

該條所有 research / synth agent 因 schema 設計對『做 WebSearch 的研究型 agent』過嚴而未呼叫 StructuredOutput,結果為空。下次重跑需放寬 schema(改自由文字回傳,或讓 research 階段不綁 schema、只在 synth 綁)。
