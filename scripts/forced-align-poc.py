#!/usr/bin/env python3
"""forced-align-poc — 把「TTS 合成的乾淨中文 WAV + 已知逐字原文」反推每個漢字的
char-level 時間戳(start_ms / end_ms),驗證「voai.ai 不吐 timestamp 時改走 forced
alignment」這條路線可行(docs/meta/plans/04-stage3-tts-pipeline.md §2.2 路線 A)。

方案(見研究結論):torchaudio.functional.forced_align + HuggingFace 中文 CTC 模型
`jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn`。該模型字典本身即「漢字」,
故對齊輸出天生就是字級、無 pinyin/BPE 反推。模型字典為簡體,繁體輸入先以 opencc t2s
轉簡體「只供對齊」,時間戳再貼回原文(繁簡 1:1,index 不錯位)。

環境(POC 專用,不污染系統 / 不進 package.json):
    python3 -m venv .venv-align && source .venv-align/bin/activate
    pip install torch==2.2.2 torchaudio==2.2.2 transformers==4.41.2 \
                opencc-python-reimplemented==0.1.7

用法:
    .venv-align/bin/python scripts/forced-align-poc.py <wav> "<逐字原文>" [out.json]
"""
from __future__ import annotations

import json
import sys

import torch
import torchaudio
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

MODEL_ID = "jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn"
SAMPLE_RATE = 16000
HANZI_LO, HANZI_HI = "一", "鿿"


def is_hanzi(ch: str) -> bool:
    return HANZI_LO <= ch <= HANZI_HI


def to_simplified(text: str) -> str:
    """繁→簡(模型是簡體字典);沒裝 opencc 時原樣回傳(全簡體輸入仍 OK)。"""
    try:
        from opencc import OpenCC

        return OpenCC("t2s").convert(text)
    except Exception:
        return text


def load_waveform(path: str) -> tuple[torch.Tensor, float]:
    wav, sr = torchaudio.load(path)
    if wav.shape[0] > 1:  # → mono
        wav = wav.mean(dim=0, keepdim=True)
    if sr != SAMPLE_RATE:
        wav = torchaudio.functional.resample(wav, sr, SAMPLE_RATE)
    duration_ms = wav.shape[1] / SAMPLE_RATE * 1000.0
    return wav, duration_ms


def align(wav_path: str, transcript: str) -> dict:
    processor = Wav2Vec2Processor.from_pretrained(MODEL_ID)
    model = Wav2Vec2ForCTC.from_pretrained(MODEL_ID).eval()

    # 原文逐字 → 只留漢字(標點/空白在音檔裡無發音,不該有時間戳)
    orig_chars = [c for c in transcript if is_hanzi(c)]
    align_chars = [to_simplified(c) for c in orig_chars]

    wav, duration_ms = load_waveform(wav_path)
    inputs = processor(
        wav.squeeze(0).numpy(), sampling_rate=SAMPLE_RATE, return_tensors="pt"
    )
    with torch.inference_mode():
        logits = model(inputs.input_values).logits  # (1, T, C)
    log_probs = torch.log_softmax(logits, dim=-1)

    vocab = processor.tokenizer.get_vocab()
    unk_id = processor.tokenizer.unk_token_id
    blank_id = processor.tokenizer.pad_token_id or 0
    target_ids = [vocab.get(c, unk_id) for c in align_chars]
    n_unk = sum(1 for t in target_ids if t == unk_id)
    targets = torch.tensor([target_ids], dtype=torch.int32)

    aligned, scores = torchaudio.functional.forced_align(
        log_probs, targets, blank=blank_id
    )

    n_frames = log_probs.shape[1]
    ms_per_frame = duration_ms / n_frames

    # 把 frame 級對齊收斂成「每個 target token 一段」。torchaudio 有 merge_tokens;
    # 沒有就手動依「非 blank token 邊界」分段(兩者結果一致)。
    spans: list[tuple[int, int, float]] = []  # (start_frame, end_frame, mean_score)
    merge = getattr(torchaudio.functional, "merge_tokens", None)
    if merge is not None:
        for ts in merge(aligned[0], scores[0], blank=blank_id):
            spans.append((int(ts.start), int(ts.end), float(ts.score)))
    else:
        path = aligned[0].tolist()
        sc = scores[0].tolist()
        idx, last_blank, start = -1, True, 0
        acc: list[float] = []
        for f, tok in enumerate(path):
            if tok == blank_id:
                last_blank = True
                continue
            if last_blank:
                if idx >= 0:
                    spans.append((start, f, sum(acc) / len(acc) if acc else 0.0))
                idx += 1
                start, acc = f, []
            acc.append(sc[f])
            last_blank = False
        if idx >= 0:
            spans.append((start, len(path), sum(acc) / len(acc) if acc else 0.0))

    # CTC 對齊回的是每個字的「onset 尖峰幀」(span 多半只佔 1 幀)。卡拉OK 高亮要的是
    # 連續區間:第 i 字 active 於 [onset_i, onset_{i+1});末字延伸到音檔尾。
    onsets_ms = [round(sf * ms_per_frame) for (sf, _ef, _s) in spans]
    chars = []
    for i, ch in enumerate(orig_chars):
        if i < len(onsets_ms):
            start_ms = onsets_ms[i]
            end_ms = onsets_ms[i + 1] if i + 1 < len(onsets_ms) else round(duration_ms)
            chars.append(
                {
                    "char": ch,
                    "charIndex": i,
                    "startMs": start_ms,
                    "endMs": end_ms,
                    "score": round(spans[i][2], 3),
                }
            )
        else:
            chars.append(
                {"char": ch, "charIndex": i, "startMs": None, "endMs": None, "score": None}
            )

    return {
        "audioDurationMs": round(duration_ms),
        "emissionFrames": int(n_frames),
        "msPerFrame": round(ms_per_frame, 2),
        "charCount": len(orig_chars),
        "unkCount": n_unk,
        "chars": chars,
    }


def report(result: dict) -> None:
    print("\n🧩 forced-align-poc — 中文字級 forced alignment 真打")
    print("=" * 64)
    print(
        f"音檔 {result['audioDurationMs']}ms｜emission {result['emissionFrames']} frames"
        f"｜{result['msPerFrame']}ms/frame｜漢字 {result['charCount']} 個｜<unk> {result['unkCount']}"
    )
    print(f"\n{'idx':>3} {'char':^4} {'start':>7} {'end':>7} {'dur':>6} {'score':>6}")
    print("-" * 40)
    prev_end = 0
    mono = True
    durs = []
    for c in result["chars"]:
        s, e = c["startMs"], c["endMs"]
        if s is None:
            print(f"{c['charIndex']:>3} {c['char']:^4}   (未對齊)")
            continue
        dur = e - s
        durs.append(dur)
        if s < prev_end - 5:  # 容 5ms 抖動
            mono = False
        prev_end = e
        print(f"{c['charIndex']:>3} {c['char']:^4} {s:>7} {e:>7} {dur:>6} {c['score']:>6}")
    if durs:
        avg = sum(durs) / len(durs)
        print("-" * 40)
        print(
            f"每字時長:min {min(durs)} / avg {round(avg)} / max {max(durs)} ms"
            f"｜單調遞增:{'✅' if mono else '❌'}"
        )
    print(
        "\nVERDICT:"
        + (
            "✅ forced alignment 可吐字級 timestamp,單調且時長合理 → 路線 A 可行。"
            if result["chars"] and result["chars"][0]["startMs"] is not None and mono
            else "⚠️ 需人工檢視(見上表)。"
        )
    )


def main() -> None:
    if len(sys.argv) < 3:
        print('用法: python scripts/forced-align-poc.py <wav> "<逐字原文>" [out.json]')
        sys.exit(1)
    wav_path, transcript = sys.argv[1], sys.argv[2]
    out_path = sys.argv[3] if len(sys.argv) > 3 else None
    result = align(wav_path, transcript)
    report(result)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"\n📝 JSON 已寫:{out_path}")


if __name__ == "__main__":
    main()
