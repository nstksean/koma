/**
 * 產一個 member 邀請碼,寫入 DB(只存 sha256),把明碼印出來一次(發給試用者)。
 *
 *   npm run code:gen -- "朋友A 試用"      # 帶 label
 *   npm run code:gen                       # 無 label
 *
 * 走本地 data/blackcat.db;要寫雲端就先設 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN。
 * 停用某碼:DB 把該列 disabled 設 1(或 db:studio 改)。
 */
import { createClient } from "@libsql/client";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";

const label = process.argv[2] ?? "";

// 24 bytes → base64url ≈ 32 字元,足夠高熵且好複製。
const code = `koma-${randomBytes(18).toString("base64url")}`;
const codeHash = createHash("sha256").update(code).digest("hex");
const id = randomBytes(8).toString("hex");

const client = createClient({
  url:
    process.env.TURSO_DATABASE_URL ??
    `file:${path.join(process.cwd(), "data", "blackcat.db")}`,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main(): Promise<void> {
  await client.execute({
    sql: "INSERT INTO access_codes (id, code_hash, role, label, disabled, created_at) VALUES (?, ?, 'member', ?, 0, ?)",
    args: [id, codeHash, label, Date.now()],
  });
  console.log("\n✅ 已產生 member 邀請碼(明碼只顯示這一次):\n");
  console.log(`   ${code}\n`);
  console.log(`   id=${id}  label=${label || "(無)"}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("產碼失敗:", err);
    process.exit(1);
  });
