# 身分系統:邀請碼與 Email + 密碼並存

為什麼 Koma 同時有兩套登入,它們怎麼共存,以及舊系統的淘汰路徑。

## 兩套系統

| 系統 | 身分來源 | session | 額度 identity 命名空間 |
|---|---|---|---|
| **舊:邀請碼**(既有) | `ADMIN_CODES`/`REFERRAL_CODES`(env)、`access_codes`(DB)、`@iqt.ai` 自助 | 無狀態 HMAC cookie `koma_session`([lib/auth.ts](../../lib/auth.ts)) | `admin:<id>` / `member:<id>` / `iqt:<hash>` |
| **新:Email + 密碼**(better-auth) | 任何 email + 密碼;`ADMIN_EMAILS`(env)= admin | better-auth DB session cookie([lib/better-auth.ts](../../lib/better-auth.ts)) | `user:<userId>` |
| 未登入 | hashed IP | 無 | `guest:<hash>` |

## 為什麼並存,而非一次切換

- **直接砍舊系統** → 現有測試者 cookie 立刻失效、被迫全員重登,風險高。
- **把邀請碼資料遷移成 better-auth 帳號** → 邀請碼沒有 email,無法生帳號,遷移無意義。

並存讓兩條路各自運作、舊路自然淘汰。新功能(Google/Apple/passkey)都是 better-auth plugin,不動橋接層。

## 唯一交會點:`getServerAuth()`

[lib/auth-server.ts](../../lib/auth-server.ts) 是唯一身分入口,解析優先序:

```
1. better-auth session 有效 → user:<userId>(role 依 ADMIN_EMAILS)
2. 舊 HMAC koma_session 有效 → admin|member:<id>
3. 否則 → guest(hashed IP)
```

額度系統([lib/tts-quota.ts](../../lib/tts-quota.ts))只吃 `Auth.identity` 字串,對命名空間無感 → **新舊共存、`tts_usage` 零 schema 變更、零資料遷移**。TTS route 也走 `getServerAuth()`(非舊的 `resolveAuth(req)`),email 登入者的額度才會計在 `user:` 桶而非訪客 IP 桶。

> 天花板:舊 member 在改用 email 登入「之前」,額度桶仍是舊 `member:<id>`;改登入後換到 `user:<id>` 桶(等於當日額度重置一次)。可接受。

## 淘汰路徑(未來)

1. 引導現有 member 改用 email 登入。
2. 觀察舊 `koma_session` 使用量降到可忽略。
3. 移除 [lib/auth-server.ts](../../lib/auth-server.ts) 的第 2 步與 `lib/auth.ts` 的邀請碼邏輯;`access_codes` 可轉為純 beta gate(註冊前驗碼,env `BETA_REQUIRE_INVITE`,目前未啟用)。

## 已知債(非本功能引入)

舊邀請碼的 `unlockThrottled()`([lib/unlock-rate-limit.ts](../../lib/unlock-rate-limit.ts))是行程內記憶體限流,Vercel 多實例下無效(已有 ponytail 註記)。better-auth 的登入限流走 DB(`rateLimit` 表),serverless 安全。要收斂舊路時一併處理。

另見:[../how-to/deploy.md](../how-to/deploy.md) 環境變數設定。
