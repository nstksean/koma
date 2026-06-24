import { NextResponse, type NextRequest } from "next/server";

import { GUEST_COOKIE } from "@/lib/guest";

/**
 * 確保每個訪客瀏覽器都有一個匿名 id cookie。書架/進度以此為擁有者(每人一桶);
 * 沒有它時 getServerDataOwner 才退回 hashed IP(同 IP 會共用,僅後備)。
 * TTS 額度不受影響:仍走 getServerAuth().identity(guest = hashed IP)。
 */
export function middleware(request: NextRequest): NextResponse {
  if (request.cookies.get(GUEST_COOKIE)?.value) return NextResponse.next();

  const id = crypto.randomUUID();
  // 同時寫進「本次請求」的 cookie,讓首次造訪的 RSC/action 立刻讀得到(否則首訪會先落到 IP 桶)。
  request.cookies.set(GUEST_COOKIE, id);
  const res = NextResponse.next({ request: { headers: request.headers } });
  res.cookies.set(GUEST_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365, // 1 年
    path: "/",
  });
  return res;
}

// 跳過靜態資產;其餘(頁面、API、server action)都過,確保拿得到 cookie。
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
