/**
 * TTS 逐字高亮的 DOM 接縫常數（凍結接縫，§平行契約 4）。
 * 渲染端（reader-content）用 DATA_CI 對 [...content] 逐字編號掛屬性；
 * 播放器（audio-player）用同樣的屬性名 querySelector + TTS_ACTIVE_CLASS 上 class。
 * 抽成共用常數避免兩邊字串 typo 導致高亮全失效且難查。
 */

/** 逐字 span 的 data 屬性名。值 = 該字在 [...content] 的 code-point index。 */
export const DATA_CI = "data-ci";

/** 當前高亮字的 class 名（樣式定義在 app/globals.css）。 */
export const TTS_ACTIVE_CLASS = "tts-active";
