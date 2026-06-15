/**
 * 書名覆寫表：來源站偶有把書名抓壞（如 ttkan 將某書名顯示成含「（Error）」的字串）。
 * 以 `${source}:${sourceBookId}` 為鍵，覆寫成正確書名。
 */
const OVERRIDES: Readonly<Record<string, string>> = {
  // ttkan 把這本顯示成「地獄遊戲：從大都會開始（Error）」，slug 才是正確拼音。
  "ttkan:doudiyuyouxile_sheihaidangrena-youjiul": "都地獄遊戲了，誰還當人啊",
};

/** 套用覆寫；無覆寫時，去掉來源站殘留的「（Error）」雜訊後回傳。 */
export function resolveTitle(
  source: string,
  sourceBookId: string,
  fetchedTitle: string,
): string {
  const override = OVERRIDES[`${source}:${sourceBookId}`];
  if (override) return override;
  return fetchedTitle.replace(/\s*（Error）\s*$/u, "").trim() || fetchedTitle;
}
