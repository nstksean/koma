/**
 * 章節純文字分塊（chunkContent）—— 純函式,無副作用(04 Workstream A)。
 *
 * 把一章純文字切成 ≤maxCodePoints 的塊,供 Azure 逐段合成(避開單次音長上限)。
 * 與 play-chapter-azure 的 chunkText 不同:本函式【絕不 trim、絕不丟字】,
 * 完整保留 \n 與半形空格,以維持 code-point 連續性 —— 這是「最終高亮 charIndex
 * 對齊 [...chapterContent]」全功能正確性的根。每塊帶 cpStart(該塊首字在原文
 * [...content] 的 code-point index),供後續 azureWordsToChars(seg, -cpStart)
 * 還原全域 charIndex。
 */

/** 一塊待合成文字 + 它在原文 [...content] 的起始 code-point index。 */
export interface ContentChunk {
  readonly text: string;
  readonly cpStart: number;
}

const DEFAULT_MAX_CODE_POINTS = 900;

/**
 * 把 content 依 code-point 切成連續塊,每塊 ≤maxCodePoints。
 *
 * 演算法:游標 i 從 0;每塊 cpStart=i,窗 [i, min(i+max, len));在窗內找
 * 「最後一個 \n」位置 nl,若 nl>i 則切到 nl+1(含換行),否則切到窗尾
 * (超長無換行硬切)。直到 i>=len。
 *
 * 不變式(由測試守護):
 *   1. chunks.map(c=>c.text).join("") === content(round-trip 無損)。
 *   2. chunk[k].cpStart === chunk[k-1].cpStart + [...chunk[k-1].text].length
 *      (連續、無 gap、無重疊)。
 *
 * @param content       章節已清洗純文字(含標點、含 \n)。
 * @param maxCodePoints 每塊 code-point 上限,預設 900。
 */
export function chunkContent(
  content: string,
  maxCodePoints: number = DEFAULT_MAX_CODE_POINTS,
): readonly ContentChunk[] {
  const cps = [...content]; // code-point 陣列,正確處理 surrogate pair
  const len = cps.length;
  const chunks: ContentChunk[] = [];

  let i = 0;
  while (i < len) {
    const cpStart = i;
    const windowEnd = Math.min(i + maxCodePoints, len);

    // 在窗 [i, windowEnd) 內找最後一個 \n。
    let nl = -1;
    for (let j = windowEnd - 1; j >= i; j--) {
      if (cps[j] === "\n") {
        nl = j;
        break;
      }
    }

    // nl>i:切到換行之後(含 \n);否則(無換行或換行就在塊首)切到窗尾。
    const cut = nl > i ? nl + 1 : windowEnd;

    chunks.push({
      text: cps.slice(cpStart, cut).join(""),
      cpStart,
    });
    i = cut;
  }

  return chunks;
}
