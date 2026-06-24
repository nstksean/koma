/**
 * 訪客匿名 id 的 cookie 名稱。middleware 寫入(每瀏覽器一個 uuid),
 * getServerDataOwner 讀取當書架/進度的擁有者。額度不受影響(仍以 hashed IP 計)。
 *
 * 刻意獨立成不帶 "server-only" 的小檔:middleware 跑在 edge,不能 import server-only 的
 * lib/auth.ts;靠這個共用常數避免兩處字串對不上而靜默失效。
 */
export const GUEST_COOKIE = "koma_guest";
