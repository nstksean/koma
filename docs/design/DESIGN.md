# Design System — Koma 🐈

> 設計真理來源。改任何 UI / 視覺前先讀這份;不要在沒有明確同意下偏離。
> 由 `/design-consultation` 於 2026-06-15 建立。

## Product Context
- **What this is:** 零廣告、乾淨、可自訂書源的中文小說閱讀器(+ 規劃中的 TTS 聽書)。
- **Who it's for:** 想要無干擾、可自訂、繁中長文閱讀體驗的讀者(iOS 優先 + Web)。
- **Space/industry:** 電子書 / 小說閱讀器。同類:微信讀書、Apple Books、多看、Legado。
- **Project type:** Reading app(閱讀頁為核心)+ 外殼(書庫 / 搜尋 / 設定)。

## Memorable Thing(設計北極星)
**一隻陪你夜讀的貓。** 溫暖、有陪伴感、夜間友善。後面每個設計取捨都要服務這句話。

## Aesthetic Direction
- **Direction:** Cozy Literary(暖色文學感)—— 像一盞夜讀檯燈、紙感、角落打盹的貓。
- **Decoration level:** intentional —— 細微質感 + 一隻克制的線條貓;不喧賓奪主。
- **Mood:** 安靜、溫暖、夜間沉浸。閱讀頁退到最後,讓內文與讀者獨處。
- **Reference sites:** [微信讀書](https://weread.qq.com/)(中文排版標竿,但偏淺底+藍)、[Apple Books](https://www.apple.com/apple-books/)(文學品牌語氣)、[justfont 電子書字型指南](https://blog.justfont.com/2025/10/fonts-for-ereaders/)(繁中字體)。

## Themes(主題系統 — 三個全部內建可切換)
閱讀器的 SAFE 基本盤就是多主題。Koma 內建三個命名主題,使用者可在設定切換。**預設 = Cat-Eye Dusk。**

### 1. Cat-Eye Dusk 貓眼 ★ DEFAULT(dark)
霧綠主色(貓眼)、偏冷暖炭底。最有獨立個性、最不像別人。
| token | hex |
|---|---|
| `--bg` | `#151A19` |
| `--surface` | `#1D2422` |
| `--surface-2` | `#243029` |
| `--ink`(內文) | `#E7EAE4` |
| `--muted` | `#8B968E` |
| `--accent`(主色) | `#7FBBA2` |
| `--accent-ink`(主色上的字) | `#10211B` |
| `--border` | `#2A332F` |
| `--secondary`(極少量點綴/琥珀) | `#E7AC5E` |

### 2. Ember Night 暖夜(dark)
燈光琥珀 + 暖炭底。最貼「夜讀的貓」的暖意。
| token | hex |
|---|---|
| `--bg` | `#17140F` |
| `--surface` | `#221D16` |
| `--surface-2` | `#2A241D` |
| `--ink` | `#ECE4D5` |
| `--muted` | `#9C9180` |
| `--accent` | `#E7AC5E` |
| `--accent-ink` | `#1A140C` |
| `--border` | `#342D23` |
| `--secondary`(霧綠) | `#6FA893` |

### 3. Clean Paper 淨紙(light)
淺底、近單色、大留白。白天 / 明亮環境閱讀。
| token | hex |
|---|---|
| `--bg` | `#FAF8F3` |
| `--surface` | `#FFFFFF` |
| `--surface-2` | `#F4ECDB` |
| `--ink` | `#1B1813` |
| `--muted` | `#8C8578` |
| `--accent` | `#C2762B` |
| `--accent-ink` | `#FFFFFF` |
| `--border` | `#ECE6D9` |
| `--secondary`(霧綠) | `#5E8B7E` |

> **易加第 4 個:** Sepia 護眼(`--bg #E8D9BC` / `--ink #463A28` / `--accent #B5651D`)。結構同上,之後想加直接複製一組 token。
> **主色用法:** accent 只出現在章名、進度條、主按鈕、「在讀」狀態等少數重點;不要整片用。
> **無障礙:** 內文 ink 對 bg 需維持 WCAG AA(已大致符合);accent 當文字時注意對比,必要時用 `--ink` 而非 accent。

## Typography
**內文以黑體為主**(使用者回饋:明體辨別度太低,降為可選)。
- **Display / Hero / 字標:** **Fraunces**(variable, old-style serif)— 給品牌文學的臉,避開 Inter/Poppins 收斂陷阱。
- **閱讀內文(CJK,預設):** **Noto Sans TC / 思源黑體** — 辨別度高、夜讀清晰。
- **閱讀內文(CJK,可選):** **Noto Serif TC / 思源宋體(明體)** — 提供給偏好實體書感的人,設定可切,**非預設**。
- **UI / 標籤 / 拉丁:** **Source Sans 3**(+ Noto Sans TC 補 CJK)。
- **Code/Data:** 暫無需求;若需要用 DM Mono。
- **Loading:** Google Fonts(`Fraunces`, `Noto Sans TC`, `Noto Serif TC`, `Source Sans 3`)。上 production 建議自架 / subset 思源系字重以控體積。
- **Scale(rem base 16px):**
  - 閱讀內文:預設 20px(可調 小18 / 中20 / 大23),`line-height` **1.95**,行寬約 **19–21em**(≈28–38 CJK 字)。
  - 章名:Noto Sans TC 700,24–28px。
  - 章節 eyebrow:Fraunces 12–13px,letter-spacing .12em,uppercase。
  - UI:14–15px。標題(外殼):Fraunces 28–34px。

## Color
- **Approach:** 暖色克制系(restrained)。主色稀有且有意義。
- **主色語意:** 每個主題定義自己的 `--accent`(貓眼霧綠 / 燈光琥珀 / 紙上琥珀)。
- **次要色:** `--secondary` 極少量點綴(章節進度小點、「在讀」標記)。
- **不用品類預設的藍** —— 刻意差異化。
- **Dark mode:** 預設即暗(Cat-Eye Dusk);底色用暖/帶綠的炭,不用純黑。

## Spacing
- **Base unit:** 4px。
- **Density:** 閱讀頁 spacious(大留白、寬行距);外殼 comfortable。
- **Scale:** 2xs(2) xs(4) sm(8) md(12) lg(16) xl(24) 2xl(32) 3xl(48) 4xl(64)。

## Layout
- **Approach:** hybrid —— 閱讀頁嚴格(單欄置中、限制行寬);外殼可編輯式溫度。
- **Grid:** 書庫 `auto-fill minmax(150px,1fr)`;閱讀頁單欄。
- **Max content width:** 外殼 1080px;閱讀內文行寬約 19–21em。
- **Border radius:** sm 6px / md 12px / lg 20px / full 999px。

## Motion
- **Approach:** minimal-functional + 一個招牌「貓」微動作。
- **招牌動作:** 開 app 時貓伸懶腰;章末貓蜷起睡著(「貓睡著了 · 本章結束」)。其餘安靜。
- **Easing:** enter `ease-out` / exit `ease-in` / move `ease-in-out`。
- **Duration:** micro 50–100ms / short 150–250ms / medium 250–400ms / long 400–700ms。主題切換 ~400ms 漸變。

## Brand Character — 貓 🐈
- 一隻**單線條、單色(用 `--accent`)、克制**的蜷睡貓(見 preview 的 inline SVG `#cat-curl`)。
- 出現在:字標旁、空狀態、載入、章節結尾。**少量、稀有**,過頭會變廉價 / AI 味。
- 是 Koma 的記憶點本體 ——「一隻陪你夜讀的貓」。

## SAFE / RISK 紀錄
- **SAFE(品類及格線):** 多主題(日/護眼/夜)、可調字級/行距/字體;單欄置中限制行寬;跟隨系統深色。
- **RISK(Koma 的臉):**
  1. 主色用霧綠/琥珀,不用品類預設的藍 → 一眼差異化。
  2. 把貓做成真正的品牌角色,不只 emoji → 記憶點。
  3. 主題化而非單一風格 → 三個方向全做成可切換(使用者要求),預設貓眼。
- **已否決的 risk:** 明體當預設內文 —— 使用者回饋辨別度太低,改黑體為主、明體可選。

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-15 | 建立設計系統(`/design-consultation`) | 基於產品脈絡 + 視覺研究(微信讀書 / Apple Books / justfont) |
| 2026-06-15 | 記憶點 = 「一隻陪你夜讀的貓」 | 使用者選定;錨定所有取捨 |
| 2026-06-15 | 內文改黑體為主、明體降為可選 | 使用者回饋:明體辨別度太低 |
| 2026-06-15 | 三方向全做成可切換主題,**預設 Cat-Eye Dusk** | 使用者要求保留三者並指定貓眼當 default |
| 2026-06-15 | 保留線條貓為品牌角色 | 使用者:「貓貓的 icon 很可愛」 |
