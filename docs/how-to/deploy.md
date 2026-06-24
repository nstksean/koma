# 部署到 Vercel + Turso

把 Koma web 端部署上線的步驟。技術棧已決定走 **Vercel(host)+ Turso(managed DB)**,無 Docker、無 custom server,所以這份只是「連 repo、塞環境變數、跑 migration」三件事。

> 為何是這個組合,以及被排除的選項(Cloudflare / 自架),見 [../explanation/deploy-target.md](../explanation/deploy-target.md)(待建)。目前結論:Next 16 的第一方 host 是 Vercel,Turso 本來就是 managed,自架沒有任何理由。

## 前置

- 一個 [Vercel](https://vercel.com) 帳號,repo 已連到 GitHub。
- 安裝 Turso CLI:`curl -sSfL https://get.tur.so/install.sh | bash`(或 `brew install tursodatabase/tap/turso`)。
- 本機已能 `npm run build` 通過。

## 1. 建 production 資料庫(Turso)

```bash
turso db create koma                 # 建一顆雲端 SQLite
turso db show koma --url             # → TURSO_DATABASE_URL(libsql://...)
turso db tokens create koma          # → TURSO_AUTH_TOKEN
```

留好這兩個值,下一步要用。

## 2. 對 production DB 跑 migration

Migration 在**本機**對 production 跑,**不要**放進 Vercel build(build 環境不該有寫庫權限,且每次 deploy 重跑沒意義)。`drizzle.config.ts` 讀的是同一組 `TURSO_*` 環境變數:

```bash
TURSO_DATABASE_URL='libsql://koma-...' \
TURSO_AUTH_TOKEN='...' \
npm run db:migrate
```

之後改 schema 的流程:`npm run db:generate`(產生 migration 檔)→ 再跑上面這段。

## 3. (選)產生 admin / member 邀請碼

```bash
# admin:設進 ADMIN_CODES 環境變數即可(逗號分隔,無限額度)
# member:存 DB(只存 sha256),用腳本產:
TURSO_DATABASE_URL='...' TURSO_AUTH_TOKEN='...' npm run code:gen -- "給某人"
```

## 4. 在 Vercel 設環境變數

Vercel → 專案 → Settings → Environment Variables,scope 選 **Production**(本機開發仍走 `.env.local`)。

### 必填(缺了會壞)

| 變數 | 說明 |
|---|---|
| `TURSO_DATABASE_URL` | 第 1 步的 url。**留空會 fallback 到本機檔案 DB**,在 serverless 上等於每次請求一顆空庫 → 一定要設。 |
| `TURSO_AUTH_TOKEN` | 第 1 步的 token。 |
| `SESSION_SECRET` | session cookie 的 HMAC 簽章金鑰,**至少 16 字元**。production 缺這個會在啟動時直接 throw([lib/auth.ts:44](../../lib/auth.ts#L44))。產一把:`openssl rand -base64 32`。 |
| `ADMIN_CODES` | 你的 admin 邀請碼(逗號分隔)。沒設就沒人是 admin。 |

### 選填

| 變數 | 預設 | 何時設 |
|---|---|---|
| `TTS_QUOTA_MEMBER` / `TTS_QUOTA_GUEST` | 30 / 5 | 想調每日合成額度時。 |
| `TRUSTED_PROXY_HOPS` | 1 | rate-limit 的 client IP 取錯時再調([lib/client-ip.ts](../../lib/client-ip.ts));Vercel 單層代理通常維持 1 即可。 |
| `AZURE_TTS_KEY` / `AZURE_TTS_REGION` | — | TTS 真的上線後(見下方 ⚠️)。 |
| `ELEVENLABS_*` / `IQT_TTS_*` | — | 備選 / 自家音源,目前仍在 spike。 |
| `TTS_CACHE_MAX_MB` | 1024 | 同上,TTS 上線後且改用持久化儲存後才有意義。 |

## 5. 部署

連了 GitHub 後,push 到預設分支即自動部署。手動:

```bash
vercel link        # 第一次,把本地 repo 綁到 Vercel 專案
vercel --prod
```

Build command 用預設的 `next build` 即可,不要加 migration。

## 6. 驗收

- 首頁能開、書籍封面能載入(外部圖片網域已在 [next.config.ts](../../next.config.ts) 放行)。
- 用 admin 碼登入,確認 session 有效(代表 `SESSION_SECRET` + Turso 都通)。
- 「繼續閱讀」「章節分頁」等需要寫 DB 的功能能存能讀。

---

## ⚠️ TTS 上線前必處理:檔案快取不適用 serverless

TTS 合成結果目前寫在 `process.cwd()/data/tts/`([lib/tts.ts:32](../../lib/tts.ts#L32),`mkdir`/`writeFile`)。**Vercel serverless 的檔案系統是唯讀且每次 invocation 隔離**(只有 `/tmp` 可寫,且不跨請求保留),所以這套磁碟快取在 Vercel 上不會生效 —— 每次重播都會重打 TTS API、燒額度。

目前 TTS 還在 spike / 階段 3,**reader 先上線不受影響**。等 TTS 真要上 production,擇一:

1. **改用物件儲存**:Vercel Blob / Cloudflare R2 / S3 當快取後端(改 [lib/tts.ts](../../lib/tts.ts) 的讀寫層)。
2. **TTS 走另一個持久化 host**:把合成 + 快取放到有真實磁碟的 service(Fly / VPS),web 仍留在 Vercel。

決策時再評估,別現在預先做。

另見:[../README.md](../README.md) how-to 總覽。
