import { nanoid } from "nanoid";

/** 產生資料列主鍵（21 字元，URL-safe）。 */
export function newId(): string {
  return nanoid();
}
