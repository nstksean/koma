/**
 * 交易信寄送(目前只有登入 OTP)。
 * - 無 RESEND_API_KEY/EMAIL_FROM(dev)→ 把 OTP 印到 server console,不阻塞本機開發。
 * - 有金鑰(prod)→ fetch 直打 Resend REST API。
 *
 * ponytail: 單封交易信用 fetch 足夠,要批次/重試/模板再換 resend SDK。
 * 不 import "server-only":本檔會被 lib/better-auth.ts 載入,該設定也會在非 Next
 * 情境(drizzle-kit、測試)被 import。實務上只在伺服端呼叫。
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function sendOtpEmail(to: string, otp: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    // prod 缺寄信設定 = 設定錯誤,fail fast(否則 OTP 靜默進 log、使用者收不到信卻以為成功)。
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY / EMAIL_FROM 未設定（上線必填）");
    }
    // dev fallback:沒設寄信就把碼印出來,本機照樣能登入。
    console.info(`[dev] Koma 登入驗證碼 ${to}: ${otp}`);
    return;
  }

  let res: Response;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(8_000), // 別讓 serverless 卡在無回應的寄信上
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: "你的 Koma 登入驗證碼",
        text: `你的登入驗證碼是 ${otp},5 分鐘內有效。\n若非你本人操作,請忽略此信。`,
      }),
    });
  } catch (err) {
    // 失敗細節(逾時/網路)記伺服端,不外洩給未驗證的呼叫者。
    console.error("[email] OTP 寄送失敗", err);
    throw new Error("驗證碼寄送失敗,請稍後再試");
  }

  if (!res.ok) {
    console.error(`[email] Resend ${res.status}:`, await res.text().catch(() => ""));
    throw new Error("驗證碼寄送失敗,請稍後再試");
  }
}
