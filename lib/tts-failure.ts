/**
 * 把 TTS 合成/播放 catch 到的 error 映射成「使用者面文案」+「log 用技術原因」。
 *
 * 動機:player 過去把所有失敗塌成同一句泛用訊息,catch 直接丟棄真正的 error,
 * 既無從記錄原因、也無法給使用者有意義的提示。此處把原因細分(逾時/網路/HTTP)
 * 並保留技術細節到 log 欄(供 console.error),user 欄才給 UI / toast。
 */

/** 原因無法細分時的泛用退路文案(亦即 player 的 synthFailed)。 */
export const GENERIC_SYNTH_FAILED = "聽書合成失敗,請稍後再試。";

export interface FailureInfo {
  /** 給 UI / toast 顯示的文案,不含技術細節。 */
  readonly user: string;
  /** 給 console.error 的技術原因,可含 status / message,不外洩到 UI。 */
  readonly log: string;
}

/**
 * @param err      catch 到的未知錯誤。
 * @param timedOut 是否為首播逾時 abort(呼叫端旗標,用以和卸載 abort 區分)。
 */
export function describeFailure(err: unknown, timedOut: boolean): FailureInfo {
  if (timedOut) return { user: "合成逾時,請再試一次。", log: "timeout" };
  // fetch 本身 reject(斷網 / DNS / CORS)在瀏覽器是 TypeError。
  if (err instanceof TypeError) {
    return {
      user: "網路連線中斷,請檢查網路後再試。",
      log: `network: ${err.message}`,
    };
  }
  if (err instanceof Error) {
    // ensureLoaded 對 !res.ok 丟 `合成失敗(<status>)`,從中取出 HTTP 狀態碼。
    const status = Number(/合成失敗\((\d+)\)/.exec(err.message)?.[1]);
    if (status === 404) return { user: "找不到這個章節。", log: "http 404" };
    if (status >= 500) {
      return { user: "聽書服務忙線中,請稍後再試。", log: `http ${status}` };
    }
    return { user: GENERIC_SYNTH_FAILED, log: err.message };
  }
  return { user: GENERIC_SYNTH_FAILED, log: String(err) };
}
