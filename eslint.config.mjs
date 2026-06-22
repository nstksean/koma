// Next 16 起 eslint-config-next 改為原生 flat config;
// `core-web-vitals` 已內含 `next/typescript`,等價於舊的
// compat.extends("next/core-web-vitals", "next/typescript")。
// 不再需要 @eslint/eslintrc 的 FlatCompat(舊寫法在 ESLint 9 會
// 噴 "Converting circular structure to JSON")。
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "node_modules/**",
      ".venv-align/**",
      "next-env.d.ts",
    ],
  },
  ...nextCoreWebVitals,
  {
    // 限定 TS 檔:@typescript-eslint plugin 只在 next/typescript 的
    // config 物件(scope 為 ts/tsx)註冊,規則須同 scope 才找得到 plugin。
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          ignoreRestSiblings: true,
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      // React Compiler 版 eslint-plugin-react-hooks(Next 16 core-web-vitals 內建)對下列
      // 三條規則過度嚴格,且實測輸出「非確定性」—— 同一 commit 連跑,error 數在 1/3/7
      // 間跳動,會讓 CI 隨機變紅。本專案所有命中處皆為合法慣用法:SSR mounted-guard、
      // mount 後載入 localStorage、rAF/最新-callback ref(經 TTS 後端對抗式 review 逐條
      // 確認非 bug)。故降為 warn:保留訊號、解除隨機卡關;真正的 cascading-render 問題
      // 仍個案重構。日後 plugin 穩定後可回收這段。
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
    },
  },
];

export default eslintConfig;
