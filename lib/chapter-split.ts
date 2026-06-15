/**
 * 把一整段貼上的小說純文字切成章節（純函式，可單元測試）。
 * 偵測常見中文章節標題行：第N章/節/回/卷、序章、楔子、引子、番外、尾聲、終章…
 */

export interface SplitChapter {
  readonly title: string;
  readonly body: string;
}

// 標記後必須接「分隔符或行尾」（lookahead），否則「楔子內文…」「第一章的故事…」會被誤判成標題。
const HEADING_RE =
  /^\s*(第\s*[0-9零一二三四五六七八九十百千兩两壹貳叁肆伍陸柒捌玖拾]+\s*[章節节回卷篇]|序章|序言|楔子|引子|番外|外傳|外传|尾聲|尾声|終章|终章|后记|後記)(?=$|[\s:：、.．·—\-])/u;

const MAX_HEADING_LEN = 40;

function isHeading(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && t.length <= MAX_HEADING_LEN && HEADING_RE.test(t);
}

export function splitChapters(text: string): readonly SplitChapter[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: { title: string; body: string[] }[] = [];
  let cur: { title: string; body: string[] } | null = null;

  for (const line of lines) {
    if (isHeading(line)) {
      cur = { title: line.trim(), body: [] };
      out.push(cur);
    } else {
      if (!cur) {
        cur = { title: "正文", body: [] };
        out.push(cur);
      }
      cur.body.push(line);
    }
  }

  return out
    .map((c) => ({ title: c.title, body: c.body.join("\n").trim() }))
    .filter((c) => c.body.length > 0);
}
