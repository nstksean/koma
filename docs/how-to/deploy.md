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
| `SESSION_SECRET` | 舊邀請碼 session cookie 的 HMAC 簽章金鑰,**至少 16 字元**。production 缺這個會在啟動時直接 throw([lib/auth.ts:44](../../lib/auth.ts#L44))。產一把:`openssl rand -base64 32`。 |
| `ADMIN_CODES` | 你的 admin 邀請碼(逗號分隔)。沒設就沒人是 admin。 |
| `BETTER_AUTH_SECRET` | better-auth(Email + 密碼登入)的簽章金鑰,**≥32 字元**。production 缺/過短會 throw([lib/better-auth.ts](../../lib/better-auth.ts))。`openssl rand -base64 32`。 |
| `BETTER_AUTH_URL` | 站台正式 URL(含 protocol,例 `https://koma.app`)。production 缺會 throw。 |

### 選填

| 變數 | 預設 | 何時設 |
|---|---|---|
| `TTS_QUOTA_MEMBER` / `TTS_QUOTA_GUEST` | 30 / 5 | 想調每日合成額度時。 |
| `TRUSTED_PROXY_HOPS` | 1 | rate-limit 的 client IP 取錯時再調([lib/client-ip.ts](../../lib/client-ip.ts));Vercel 單層代理通常維持 1 即可。 |
| `AZURE_TTS_KEY` / `AZURE_TTS_REGION` | — | TTS 真的上線後(見下方 ⚠️)。 |
| `ELEVENLABS_*` / `IQT_TTS_*` | — | 備選 / 自家音源,目前仍在 spike。 |
| `TTS_CACHE_MAX_MB` | 1024 | 同上,TTS 上線後且改用持久化儲存後才有意義。 |

## 4b. Email + 密碼登入(better-auth)

email 登入與舊邀請碼系統**並存**(身分解析見 [lib/auth-server.ts](../../lib/auth-server.ts)):email 登入者 = member、`ADMIN_EMAILS` 清單 = admin。額度計在 `user:<userId>` 桶,**不需要對 `tts_usage` 做資料遷移**;auth 表(`user`/`session`/`account`/`verification`/`rateLimit`)由第 2 步的 migration 一併建立。

**不寄信、不需網域**:密碼由 better-auth 以 scrypt hash 存進 `account.password`。`requireEmailVerification: false`,所以不寄驗證信,也沒有「忘記密碼」email 重設(等買了網域再加 `sendResetPassword`)。

| 變數 | 何時設 |
|---|---|
| `ADMIN_EMAILS` | 以哪些 email 登入算 admin(逗號分隔)。沒設 = 所有 email 登入者皆 member。 |

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
- `/login` 用 email + 密碼註冊 → 自動登入,身分顯示「會員」(代表 better-auth 通)。
- 「繼續閱讀」「章節分頁」等需要寫 DB 的功能能存能讀。

---

## TTS(聽書)上線注意事項

聽書已上線。以下三點是踩過的雷與已知限制,改動 TTS 前必讀。

### 1. ✅ 已修:Azure Speech SDK 在 Vercel / Node 24 的 wss 連線

Azure Speech SDK 透過 **wss WebSocket** 合成。在 Vercel(Node 24)上會踩兩個雷,皆已修:

- **不能被 Next bundle**:必須列入 `serverExternalPackages`([next.config.ts](../../next.config.ts)),否則打包後其內部 `ws` 解析失效。
- **不能用 Node 全域 WebSocket**:Node ≥22 暴露實驗性全域 `WebSocket`(undici),SDK 一偵測到就優先用它,但連 Azure wss 會間歇性 1006 斷線。已在 [src/tts/azure-synthesize.ts](../../src/tts/azure-synthesize.ts) 設 `WebsocketMessageAdapter.forceNpmWebSocket = true` 強制走穩定的 npm `ws`。

> 症狀:聽書整路 500「聽書服務暫時無法使用」,server log 出現 `StatusCode: 1006 ... wss://<region>.tts.speech.microsoft.com`。

### 2. ⚠️ Azure 方案併發上限(429)

免費 **F0 只允許 1 條並發 wss 連線**。同實例多章、或跨實例同章一起合成時,落敗者會收到握手 **429**(`Unexpected server response: 429`)。[src/tts/azure-synthesize.ts](../../src/tts/azure-synthesize.ts) 已對 429 加長退避(1.5s 起、上限 6s、4 次)讓單次碰撞自癒,但**真正治本是升級到 S0(標準,200 並發)**。多人同時聽 / 高併發前務必升級。

### 3. ⚠️ 落地快取為 per-instance ephemeral(`/tmp`)

合成結果寫在 `os.tmpdir()/koma-tts/`([lib/tts.ts:38](../../lib/tts.ts#L38))。`/tmp` 在 Vercel 可寫但**每個 function instance 各自獨立、不跨請求保留**,所以:

- 同一章會被不同 instance 各自重合成(燒額度 + 增加 §2 的併發碰撞)。
- cache 命中不可靠(timestamps route 與 audio route 可能落在不同 instance)。

規模化的正解是 **共享持久化儲存**(Vercel Blob / R2 / S3)當快取後端,改 [lib/tts.ts](../../lib/tts.ts) 讀寫層:合成一次、所有 instance 共讀。單人輕量使用目前可接受,故先不做。

另見:[../README.md](../README.md) how-to 總覽。
