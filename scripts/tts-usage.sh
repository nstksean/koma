#!/usr/bin/env bash
# 加總 log 裡 [tts] synth 的 chars,對照 Azure Neural 免費額度 500K 字/月。
#
# 用法:
#   scripts/tts-usage.sh dev.log                 # 直接給 log 檔
#   cat dev.log | scripts/tts-usage.sh           # 從 stdin
#   vercel logs <deployment-url> | scripts/tts-usage.sh   # Vercel(僅近期串流,非整月)
#   scripts/tts-usage.sh --test                  # 自我檢查
#
# ⚠️ 整月「權威」數字請以 Azure Portal 用量為準。本工具只加總你餵進來的 log 內、
#    真正命中合成(cache miss)的字數;Vercel CLI 不保留整月 log,別當帳單。
set -euo pipefail

FREE=500000   # Azure Neural 免費額度:500K 字/月,永不過期
RATE=16       # 超額單價:US$16 / 1M 字

if [[ "${1:-}" == "--test" ]]; then
  out=$(printf '[tts] synth chars=3000 voice=x idx=1\njunk line\n[tts] synth chars=2000 voice=y idx=2\n' \
    | grep -oE 'chars=[0-9]+' | awk -F= '{s+=$2} END{print s}')
  [[ "$out" == "5000" ]] && echo "self-check OK (5000)" || { echo "self-check FAIL: got $out"; exit 1; }
  exit 0
fi

# 來源:有檔名讀檔,否則讀 stdin。
src=$(cat -- "${1:-/dev/stdin}")

echo "$src" | grep -oE 'chars=[0-9]+' | awk -F= -v free="$FREE" -v rate="$RATE" '
  {s += $2; n++}
  END {
    printf "合成次數 (cache miss): %d\n", n
    printf "已用字數:              %d\n", s
    printf "免費額度:              %d / 月\n", free
    printf "已用比例:              %.1f%%\n", (s / free) * 100
    if (s <= free)
      printf "剩餘:                  %d 字 (約還能合成 %d 章 @3000字)\n", free - s, (free - s) / 3000
    else
      printf "⚠️ 已超過免費額度 %d 字,約 US$%.2f\n", s - free, (s - free) / 1000000 * rate
  }'
