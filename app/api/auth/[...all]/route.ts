import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/better-auth";

// better-auth 全部端點(送 OTP、驗 OTP、session、登出...)掛在 /api/auth/*。
export const { GET, POST } = toNextJsHandler(auth);
