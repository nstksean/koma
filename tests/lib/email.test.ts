import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendOtpEmail } from "@/lib/email";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendOtpEmail — dev fallback", () => {
  it("無金鑰且非 production:不丟錯、不打 fetch(只印到 console)", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    vi.stubEnv("NODE_ENV", "development");

    await expect(sendOtpEmail("user@example.com", "123456")).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendOtpEmail — prod 缺設定 fail fast", () => {
  it("無金鑰且 production:丟錯(訊息提及未設定/上線必填),不打 fetch", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    vi.stubEnv("NODE_ENV", "production");

    await expect(sendOtpEmail("user@example.com", "123456")).rejects.toThrow(
      /未設定（上線必填）/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendOtpEmail — happy path", () => {
  it("有金鑰+寄件人:fetch ok → resolves;打到 Resend 端點、帶 Bearer、body 含 otp", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Koma <noreply@koma.app>");
    fetchMock.mockResolvedValue({ ok: true });

    await expect(sendOtpEmail("user@example.com", "654321")).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_test_key");
    expect(init.body).toContain("654321");
  });
});

describe("sendOtpEmail — fetch 失敗", () => {
  it("回應 !ok:丟通用文案,不外洩細節", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Koma <noreply@koma.app>");
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => "" });

    await expect(sendOtpEmail("user@example.com", "123456")).rejects.toThrow(
      "驗證碼寄送失敗,請稍後再試",
    );
  });

  it("fetch reject(網路/逾時):走 catch,丟通用文案、不外洩原始錯誤", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Koma <noreply@koma.app>");
    fetchMock.mockRejectedValue(new Error("ETIMEDOUT secret-host"));

    await expect(sendOtpEmail("user@example.com", "123456")).rejects.toThrow(
      "驗證碼寄送失敗,請稍後再試",
    );
  });
});
