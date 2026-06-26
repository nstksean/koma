import { describe, expect, it } from "vitest";

import { validateLoginInput } from "@/lib/login-validation";

describe("validateLoginInput 登入表單前端驗證", () => {
  it("合法 email + 8 碼以上密碼 → null(通過,含去空白)", () => {
    expect(validateLoginInput("a@b.co", "password1")).toBeNull();
    expect(validateLoginInput("  reader@gmail.com  ", "12345678")).toBeNull();
  });

  it("email 格式不符 → email 錯誤訊息", () => {
    for (const bad of ["", "no-at", "a@b", "@b.co", "a@.co", "a b@c.com"]) {
      expect(validateLoginInput(bad, "password1")).toBe("請輸入有效的 email");
    }
  });

  it("email 先驗:email 壞時即使密碼也太短,仍先回 email 錯誤", () => {
    expect(validateLoginInput("nope", "short")).toBe("請輸入有效的 email");
  });

  it("密碼少於 8 碼 → 密碼錯誤訊息(NIST 下限)", () => {
    expect(validateLoginInput("a@b.co", "1234567")).toBe("密碼至少 8 碼");
    expect(validateLoginInput("a@b.co", "")).toBe("密碼至少 8 碼");
  });

  it("剛好 8 碼 → 通過(邊界)", () => {
    expect(validateLoginInput("a@b.co", "12345678")).toBeNull();
  });
});
