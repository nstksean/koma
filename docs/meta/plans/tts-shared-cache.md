# TTS 共享快取 — 解掉跨實例重複合成 / 瞬時量突刺

> Status: **規劃中**(待有空處理)
> 相關:[04-stage3-tts-pipeline.md](04-stage3-tts-pipeline.md) §4 快取層

## 問題(為什麼要做)

並發一上來,Azure TTS 被重複渲染、瞬時 call 數突刺(曾見單一視窗 ~40 calls)。

根因:合成的中樞邏輯(`getChapterAudioMeta`:確認快取→沒有才打 Azure→存→回傳)其實**已正確存在**,
但它查/存用的是 `os.tmpdir()`(`/tmp`)—— 在 Vercel serverless 上是 **per-instance、ephemeral** 的暫存:

- 跨實例查不到別的實例已生好的音檔 → 每個冷實例都當 miss → 重燒整章。
- `inflight` 去重 map([lib/tts.ts:71](../../../lib/tts.ts#L71))、rate limiter 同樣是 per-instance 記憶體,跨實例失效。
- 一次播放天生打多條 request(timestamps + audio + iOS Safari 的多次 Range)→ 落到不同冷實例就各自重燒。
- Azure F0 只有 1 並發 → 跨實例同章互相 429 → 觸發重試 → call 數再翻。

## 先確認(動手前的排除步驟)

翻 Vercel function logs 的 `[tts] synth chars=... idx=...`([lib/tts.ts:132](../../../lib/tts.ts#L132)):

- 同一 idx 在短時間 **只出現 1 次** → 只是長章切段(設計如此,非 bug),這份計畫可降優先。
- 同一 idx **出現 ≥2 次** → 跨實例重複合成坐實,照本計畫做。

## 要做的事(只換儲存,不重設計流程)

把 `readCache` / 寫檔的 `/tmp` 換成**共享持久儲存**,中樞邏輯一行不改。

- **音檔(mp3)走物件儲存(Vercel Blob,首選)** —— 不要塞進 Turso/SQLite(binary 撐爆 DB、有 row 限制)。
- **metadata(timestamps JSON + durationMs + textHash)** 跟在 Blob 旁一起放(沿用現有 `<idx>.json` 形狀最省)。
- 維持現有兩檔結構(`<idx>.mp3` + `<idx>.json`),只把 `node:fs` 換成 Blob 的 put/get。

改動範圍:[lib/tts.ts](../../../lib/tts.ts) + [lib/tts-cache.ts](../../../lib/tts-cache.ts)(淘汰策略改用 Blob list/del)。**前端完全不動。**

紅利:Azure 成本從「每使用者 × 每播放 × 每冷實例 × 每 request」降成 **每章一輩子一次**。

## 先不做(YAGNI,流量證明需要再說)

- **Thundering herd 跨實例鎖**:同章在「首次合成未完成」的 ~15s 內被 N 人並發 → 仍可能重燒幾次。
  根除要 DB「合成中」標記 / 分散式鎖。小說閱讀器很罕見,先不做。
- **獨立後端服務 / queue**:現有 API route 本身就是中樞,不必另拉服務。
- **Azure 升 S0(200 並發)**:接共享快取後 429 多半消失,需要再升。
