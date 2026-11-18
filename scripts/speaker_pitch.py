"""按音高补对话的说话人（四六级对话固定一男一女两个播音员）。

做法（每段对话单独做）：
  1. 取这段录音（ffmpeg 切出、16k 单声道），parselmouth 算基频（10ms 一帧，75–400Hz）。
  2. 每句原文按自己的起止时间取有声帧的基频中位数（有声帧少于 0.15 秒的算"取不到"）。
  3. 这一段的句子在 log 基频上聚成两类（2-means）：低的一类是 M、高的是 W。
     两类中心差不到 1.25 倍（log2 0.32）的段不做（分不开）；离两类中线太近（log2 0.07 以内）的句子算"分不开"。
  4. 取不到、分不开的句子沿用上一句的说话人（第一句沿用下一句）。

  python -I scripts/speaker_pitch.py validate        在已有 M/W 标注、时间可靠的对话段上验证准确率
  python -I scripts/speaker_pitch.py fill2               （2026-11-11）说话人不齐的对话段都补齐，书上标过的句子当锚点，见 fill2()
  python -I scripts/speaker_pitch.py fill [--min 0.95] 给说话人覆盖不到 80% 的对话段补（只补空的句子），
                                                     写 "speakerSource": "pitch"；验证准确率不到 --min 不写
单线程（OMP_NUM_THREADS=1），一次一段，很轻。
"""
import argparse
import json
import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "1")
ROOT = Path(__file__).resolve().parent.parent
PAPERS = ROOT / "public" / "papers"
sys.path.insert(0, str(Path(__file__).resolve().parent))
import transcript_lint as TL  # noqa: E402

SEP_MIN = 0.32  # 两类中心至少差 2^0.32 ≈ 1.25 倍
AMBIG = 0.07


def f0_track(paper, seg):
    import numpy as np
    import parselmouth

    mp3 = ROOT / "public" / paper["audio"]["src"].lstrip("/")
    with tempfile.TemporaryDirectory() as td:
        wav = Path(td) / "s.wav"
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", f"{seg['start']:.2f}", "-to", f"{seg['end']:.2f}", "-i", str(mp3), "-ac", "1", "-ar", "16000", str(wav)],
                       check=True, stdin=subprocess.DEVNULL)
        snd = parselmouth.Sound(str(wav))
        pitch = snd.to_pitch(time_step=0.01, pitch_floor=75, pitch_ceiling=400)
    f = pitch.selected_array["frequency"]
    t = pitch.xs() + float(seg["start"])
    return np.asarray(t), np.asarray(f)


def line_f0(t, f, line):
    import numpy as np

    m = (t >= line["start"]) & (t <= line["end"]) & (f > 0)
    if m.sum() < 15:
        return None
    return float(np.log2(np.median(f[m])))


def two_means(vals):
    xs = sorted(v for v in vals if v is not None)
    if len(xs) < 4:
        return None
    lo, hi = xs[len(xs) // 4], xs[(3 * len(xs)) // 4]
    for _ in range(30):
        a = [x for x in xs if abs(x - lo) <= abs(x - hi)]
        b = [x for x in xs if abs(x - lo) > abs(x - hi)]
        if not a or not b:
            return None
        nlo, nhi = sum(a) / len(a), sum(b) / len(b)
        if abs(nlo - lo) < 1e-6 and abs(nhi - hi) < 1e-6:
            break
        lo, hi = nlo, nhi
    return lo, hi


def predict(paper, seg):
    """返回 ([预测 M/W/None（None=分不开、沿用前句前的原始结果）], [最终 M/W], 两类中心) ；分不开的段返回 None"""
    lines = seg["lines"]
    idx = [i for i, l in enumerate(lines) if not l.get("kind") and (l.get("text") or "").strip()]
    t, f = f0_track(paper, seg)
    vals = {i: line_f0(t, f, lines[i]) for i in idx}
    c = two_means(list(vals.values()))
    if not c or c[1] - c[0] < SEP_MIN:
        return None
    lo, hi = c
    mid = (lo + hi) / 2
    raw = {}
    for i in idx:
        v = vals[i]
        if v is None or abs(v - mid) < AMBIG:
            raw[i] = None
        else:
            raw[i] = "M" if v < mid else "W"
    final, prev = {}, None
    for i in idx:
        prev = raw[i] or prev
        final[i] = prev
    nxt = next((raw[i] for i in idx if raw[i]), None)
    for i in idx:
        if final[i] is None:
            final[i] = nxt
    return raw, final, (2 ** lo, 2 ** hi)


def conv_segments():
    for pid, p, seg, nums in TL.iter_segments(TL.catalog_ids()):
        if TL.is_conv(seg):
            yield pid, p, seg


def validate(log=print):
    lint = {(r["id"], r["segment"]): r for r in json.loads(TL.OUT.read_text("utf-8"))["segments"]}
    tot = ok = raw_tot = raw_ok = segs = skipped = 0
    worst = []
    for pid, p, seg in conv_segments():
        r = lint.get((pid, seg["id"]), {})
        if seg.get("source") == "asr" or r.get("speakerCover", 0) < 0.9 or (r.get("timeCorr") or 0) < 0.8 or r.get("garbled", 9) > 1:
            continue
        res = predict(p, seg)
        if res is None:
            skipped += 1
            continue
        raw, final, cen = res
        segs += 1
        a = b = 0
        for i, who in final.items():
            gold = seg["lines"][i].get("speaker")
            if gold in ("M", "W") and who:
                tot += 1
                a += 1
                if who == gold:
                    ok += 1
                    b += 1
                if raw[i]:
                    raw_tot += 1
                    raw_ok += who == gold
        worst.append((b / max(1, a), pid, seg["id"], a, cen))
    worst.sort()
    acc = ok / max(1, tot)
    log(f"验证：{segs} 段对话（另 {skipped} 段两类分不开没做），{tot} 句：准确率 {acc:.1%}；其中直接判的 {raw_tot} 句准确率 {raw_ok / max(1, raw_tot):.1%}")
    for w in worst[:6]:
        log(f"  最差：{w[1]} {w[2]} {w[0]:.0%}（{w[3]} 句，中心 {w[4][0]:.0f}/{w[4][1]:.0f}Hz）")
    return acc


def fill(min_acc, log=print):
    acc = validate(log)
    if acc < min_acc:
        log(f"准确率 {acc:.1%} 不到 {min_acc:.0%}，不写")
        return
    changed = {}
    for pid, p, seg in conv_segments():
        c = TL.content(seg["lines"])
        if not c or sum(1 for l in c if l.get("speaker")) / len(c) >= 0.8:
            continue
        res = predict(p, seg)
        if res is None:
            log(f"  {pid} {seg['id']}：两类分不开，留空")
            continue
        raw, final, cen = res
        n = 0
        for i, who in final.items():
            l = seg["lines"][i]
            if not l.get("speaker") and who:
                l["speaker"] = who
                n += 1
        if n:
            seg["speakerSource"] = "pitch"
            changed[pid] = p
            log(f"  {pid} {seg['id']}：补 {n} 句（中心 {cen[0]:.0f}/{cen[1]:.0f}Hz）")
    for pid, p in changed.items():
        TL.save_paper(p)
    log(f"写回 {len(changed)} 套")


ANCHOR_MIN = 6  # 书里标过说话人的句子至少几句才当锚点
ANCHOR_AGREE = 0.9  # 锚点句和音高结果一致到这个比例，补全的才算可靠


def fill2(log=print):
    """2026-11-11：界面"一段每句都有说话人才分轮"，这里把说话人不齐的对话段都补齐（只补空句）：
    - 段里书上标过的句子 ≥6 句、和音高结果一致率 ≥90%：补全，记 speakerSource "pitch+book"（界面出角色章）；
    - 否则（没有锚点或对不上）：也按音高补，记 "pitch"——界面只用它分轮（哪里换了人），不出 M/W 章；
    - 两类分不开的段不补（界面一句一行）。
    在识别重写过、时间准的段上验证过：音高逐句准确率 89%，所以只按音高分的不标男女"""
    changed = {}
    stat = {"pitch+book": 0, "pitch": 0, "分不开": 0}
    for pid, p, seg in conv_segments():
        c = [i for i, l in enumerate(seg["lines"]) if not l.get("kind") and (l.get("text") or "").strip()]
        if not c or all(seg["lines"][i].get("speaker") for i in c):
            continue
        res = predict(p, seg)
        if res is None:
            stat["分不开"] += 1
            log(f"  {pid} {seg['id']}：两类分不开，留着")
            continue
        raw, final, cen = res
        known = [i for i in c if seg["lines"][i].get("speaker") in ("M", "W")]
        agree = sum(1 for i in known if final.get(i) == seg["lines"][i]["speaker"]) / len(known) if known else 0
        src = "pitch+book" if len(known) >= ANCHOR_MIN and agree >= ANCHOR_AGREE else "pitch"
        n = 0
        for i in c:
            if not seg["lines"][i].get("speaker") and final.get(i):
                seg["lines"][i]["speaker"] = final[i]
                n += 1
        if n:
            seg["speakerSource"] = src
            stat[src] += 1
            changed[pid] = p
            log(f"  {pid} {seg['id']}：补 {n} 句，{src}（锚点 {len(known)} 句、一致 {agree:.0%}）")
    for pid, p in changed.items():
        TL.save_paper(p)
    log(f"写回 {len(changed)} 套；{stat}")


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["validate", "fill", "fill2"])
    ap.add_argument("--min", type=float, default=0.95)
    a = ap.parse_args()
    if a.cmd == "validate":
        validate()
    elif a.cmd == "fill2":
        fill2()
    else:
        fill(a.min)


if __name__ == "__main__":
    main()
