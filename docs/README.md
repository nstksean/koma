# Koma 文件

零廣告、可自訂書源的中文小說閱讀器(+ 規劃中的 TTS 聽書)的專案文件。採用 **Diátaxis + meta hybrid** 結構:外層遵循 Diátaxis,`meta/` 收納不屬四象限的工程產物。

## 我想要⋯

| 目的 | 去這裡 |
|---|---|
| 查架構地圖、資料模型、領域函式對照 | [reference/codemaps/](reference/codemaps/) |
| 部署上線、環境變數等照做步驟 | [how-to/](how-to/) |
| 理解某設計決策或背景脈絡 | [explanation/](explanation/) |
| 看設計規格(主題、字體、色彩、間距、品牌) | [design/](design/) |
| 看實作計畫、執行文件、roadmap | [meta/plans/](meta/plans/) |
| 看一次性研究、競品分析、選型 spike | [meta/assessments/](meta/assessments/) |
| 工程內部產物總覽(計畫 + 稽核) | [meta/](meta/) |

## 目錄結構

```
docs/
├── reference/         資訊導向。權威查表(架構地圖、資料模型、函式對照)。
│   └── codemaps/        各子系統的元件 / 檔案 / 函式對照表(先讀 INDEX.md)。
├── how-to/            任務導向。「如何完成 X?」可照做的步驟。
├── explanation/       理解導向。設計動機、背景脈絡(「為何如此設計」)。
├── design/            設計規格(主題 / 字體 / 色彩 / 品牌貓)。
└── meta/              工程內部產物(不對外)。
    ├── assessments/     一次性技術稽核、競品分析、選型 spike。
    ├── plans/           進行中 / 已完成的計畫、執行文件、roadmap。
    └── archive/         (規劃中)已過期、僅供歷史參考的文件。
```

> `tutorials/`、`meta/archive/` 為規劃中象限,**待有第一份內容再連同 README 一起長出來**(目前無對應內容,故先不建空目錄)。

## 撰寫新文件 — 該放哪個目錄?

問自己:**這份文件給誰看?為什麼?**

- 讀者已知目標、要步驟 → `how-to/`
- 讀者要查表(架構 / API / 路徑 / 慣例) → `reference/`
- 讀者想理解某決策或背景 → `explanation/`
- 設計規格(主題 / token / 視覺) → `design/`
- 工程產物(計畫 / 稽核 / 歸檔) → `meta/{plans,assessments,archive}/`

都不符合,**預設放 `meta/`**,不要往頂層加散檔。

## 慣例

- 檔名:`kebab-case.md`。
- 每份檔案開頭:`# Title` + 一行摘要。
- 交叉引用使用**相對路徑**。
- 過時文件**歸檔,不刪除**:搬到 `meta/archive/`。
- 多來源衝突時**不在文件中自行裁決**,標註在索引或收進 open-questions 交決策者。

另見:[../CLAUDE.md](../CLAUDE.md) 專案整體慣例。
