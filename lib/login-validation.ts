/**
 * 登入表單前端驗證(純 UX 防呆)。回傳錯誤訊息字串,或 null 表通過。
 * 真正的信任邊界在 better-auth 伺服端(emailAndPassword.minPasswordLength: 8)。
 */

// 寬鬆的 client 端格式檢查;真正的驗證在 better-auth 伺服端。
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// 鏡像 better-auth 的 minPasswordLength(NIST 800-63B 下限)。
const MIN_PASSWORD = 8;

export function validateLoginInput(email: string, password: string): string | null {
  if (!EMAIL_RE.test(email.trim())) return "請輸入有效的 email";
  if (password.length < MIN_PASSWORD) return "密碼至少 8 碼";
  return null;
}
