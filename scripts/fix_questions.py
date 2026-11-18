"""听力"读题行"（kind=question，问题卡片上显示的就是这些字）的清洗：

  python -I scripts/fix_questions.py scan [--json]       统计坏读题行（只读）
  python -I scripts/fix_questions.py punct [--dry]       不用录音能修的：读题句以疑问词/助动词开头却以句号结尾 → 问号；
                                                         问号后面是乱码、选项标记、Section 的截掉；删掉 text 为空的正文行
  python -I scripts/fix_questions.py tail [id ...]       坏读题行所在的段，只识别段尾一截录音（段尾 −（题数×22+10 秒）→ 段尾），
                                                         缓存 data/cache/asr/<id>.<段>.tail.json（一个进程、模型只载一次）
  python -I scripts/fix_questions.py apply [--dry]       按缓存里的段尾识别结果，重写坏读题行（题号对得上、题干 ≥4 个词、以问号/句号结尾才换；
                                                         一行里并着两题的拆成两行）；解析层 locate.line 同步搬家
只改试卷 JSON 的 audio 字段；第 3 套的听力跟着源套（之后跑 listen_locate.py sync）。
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import asr_listening as S  # noqa: E402
import transcript_lint as TL  # noqa: E402

ROOT = S.ROOT
QNUM = re.compile(r"Question\s+(\d{1,2})\b")
QHEAD = re.compile(r"^Question\s+\d{1,2}\.\s*")
WH = re.compile(r"^(?:what|why|how|where|when|who|whom|whose|which|do|does|did|is|are|was|were|can|could|will|would|should|have|has|had|shall)\b", re.I)
GARB = re.compile(r"[^\x00-\x7f’‘“”–—…é]|\b[A-D]\)|Section\s*[A-C]?|\bPart\b|\||[【】\[\]{}<>]")
FINAL = re.compile(r"[.?!][\"')”]*$")


def body(text):
    return QHEAD.sub("", text.strip()).strip()


def bad_reasons(text):
    """读题行哪里坏：bare 只有题号 / trunc 没收尾 / garb 夹乱码选项 / merged 并了两题"""
    r = []
    b = body(text)
    if len(QNUM.findall(text)) >= 2 or re.search(r"\|\s*\d{1,2}\.", text):
        r.append("merged")
    if len(b.split()) < 4 and not re.search(r"Question\s+\d+\.\s*Question", text):
        r.append("bare")
    elif GARB.search(b):
        r.append("garb")
    elif not FINAL.search(b):
        r.append("trunc")
    return r


def text_fix(text):
    """不用录音的修法：疑问句句号 → 问号；问号后面的乱码/选项/Section 截掉"""
    t = text.strip()
    if len(QNUM.findall(t)) >= 2:
        return t
    m = QHEAD.match(t)
    if not m:
        return t
    head, b = t[:m.end()], t[m.end():]
    q = b.find("?")
    if q >= 0 and q < len(b) - 1:
        rest = b[q + 1:]
        if GARB.search(rest) or len(rest.split()) <= 3:
            b = b[:q + 1]
    if WH.match(b) and b.rstrip().endswith(".") and not GARB.search(b):
        b = b.rstrip()[:-1] + "?"
    b = b.strip()
    return head + (b[:1].upper() + b[1:] if b else b)


def own_papers():
    for pid in S.catalog_ids():
        p = S.jload(S.PAPERS / f"{pid}.json")
        if p.get("audio"):
            yield pid, p


def seg_qinfo(seg):
    nums = []
    for l in seg["lines"]:
        if l.get("kind") == "question":
            nums += [int(x) for x in QNUM.findall(l["text"])]
    for l in seg["lines"]:
        if l.get("kind") == "cue":
            m = re.search(r"Questions\s+(\d+)\s+(?:and|to)\s+(\d+)", l["text"])
            if m:
                nums += list(range(int(m.group(1)), int(m.group(2)) + 1))
    return sorted(set(nums))


def scan(as_json=False):
    c = Counter()
    bysegs = defaultdict(set)
    tot = 0
    for pid, p in own_papers():
        shared = S.shared_from(p)
        for seg in p["audio"]["segments"]:
            for l in seg["lines"]:
                if l.get("kind") != "question":
                    continue
                tot += 1
                for r in bad_reasons(l["text"]):
                    c[r] += 1
                    bysegs[r].add((pid, seg["id"]))
                if len(body(l["text"]).split()) >= 4 and WH.match(body(l["text"])) and body(l["text"]).endswith("."):
                    c["period"] += 1
    allsegs = set().union(*bysegs.values()) if bysegs else set()
    print(f"读题行 {tot}（只算有录音的套）：" + "，".join(f"{k} {v}" for k, v in c.items()) + f"；涉及 {len(allsegs)} 段")
    empty = sum(1 for pid, p in own_papers() for seg in p["audio"]["segments"] for l in seg["lines"] if not (l.get("text") or "").strip())
    print(f"text 为空的行：{empty}")
    return allsegs


def punct(dry=False):
    changed = Counter()
    for pid, p in own_papers():
        maps = {}
        for seg in p["audio"]["segments"]:
            old = seg["lines"]
            new, mapping = [], {}
            for i, l in enumerate(old):
                if not (l.get("text") or "").strip():
                    changed["empty"] += 1
                    continue
                if l.get("kind") == "question":
                    t = text_fix(l["text"])
                    if t != l["text"]:
                        changed["period" if t.rstrip("?") != l["text"].rstrip(".") and "?" in t[-2:] and l["text"].rstrip().endswith(".") else "cut"] += 1
                        l = dict(l, text=t)
                mapping[i] = len(new)
                new.append(l)
            if new != old:
                seg["lines"] = new
                maps[seg["id"]] = mapping
        if maps and not dry:
            S.save_paper(p)
            TL.remap_explain(p, maps, lambda *_: None)
    print("改动：", dict(changed))


def tail_window(seg):
    nums = seg_qinfo(seg)
    nq = max(1, len(nums))
    start = max(float(seg["start"]), float(seg["end"]) - (nq * 22 + 10))
    return start, float(seg["end"])


def tail_file(pid, sid):
    return S.ASR / f"{pid}.{sid}.tail.json"


def pending_full():
    """还在识别队列里、整段会被重写的段（不用单独识别段尾）"""
    return {(a, b) for a, b, _ in S.todo_list()}


def need_tail():
    skip = pending_full()
    out = []
    for pid, p in own_papers():
        if S.shared_from(p):
            continue
        for seg in p["audio"]["segments"]:
            if (pid, seg["id"]) in skip or seg["id"] == "all":
                continue
            if any(l.get("kind") == "question" and bad_reasons(l["text"]) for l in seg["lines"]):
                out.append((pid, seg["id"]))
    return out


def tail(ids):
    todo = [x for x in need_tail() if not ids or x[0] in ids]
    print(f"需要识别段尾的段 {len(todo)}")
    for pid, sid in todo:
        f = tail_file(pid, sid)
        if f.exists():
            continue
        p = S.jload(S.PAPERS / f"{pid}.json")
        seg = next(s for s in p["audio"]["segments"] if s["id"] == sid)
        s0, s1 = tail_window(seg)
        mp3 = S.AUDIO / p["audio"]["src"].lstrip("/")
        a, b = max(0.0, s0 - 1.0), min(float(p["audio"]["duration"]), s1 + 1.0)
        with tempfile.TemporaryDirectory() as td:
            wav = Path(td) / "t.wav"
            subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", f"{a:.2f}", "-to", f"{b:.2f}", "-i", str(mp3), "-ac", "1", "-ar", "16000", str(wav)],
                           check=True, stdin=subprocess.DEVNULL)
            t0 = time.time()
            segs, _ = S.model().transcribe(str(wav), language="en", beam_size=5, word_timestamps=True, condition_on_previous_text=False,
                                           vad_filter=True, vad_parameters={"min_silence_duration_ms": 600})
            words = [[round(w.start + a, 2), round(w.end + a, 2), w.word, round(w.probability, 3)] for sg in segs for w in sg.words or []]
        f.write_text(json.dumps({"id": pid, "segment": sid, "start": s0, "end": s1, "words": words}, ensure_ascii=False, separators=(",", ":")), "utf-8")
        print(f"  段尾 {pid} {sid}：{s1 - s0:.0f} 秒，用了 {time.time() - t0:.0f} 秒，{len(words)} 个词", flush=True)
    print("ALLDONE")


def tail_questions(pid, seg):
    """段尾识别结果里的读题行 {题号: 行}"""
    f = tail_file(pid, seg["id"])
    if not f.exists():
        return {}
    d = S.jload(f)
    lines, _ = S.segment_lines(d["words"], d["start"], d["end"], None, prev_kind0="cue")
    out = {}
    for l in lines:
        if l.get("kind") != "question":
            continue
        m = QNUM.match(l["text"])
        if not m:
            continue
        b = body(l["text"])
        if len(b.split()) < 4 or GARB.search(b) or not FINAL.search(b):
            continue
        l = dict(l, text=text_fix(l["text"]))
        out[int(m.group(1))] = l
    return out


def apply(dry=False):
    stat = Counter()
    ex = defaultdict(list)
    for pid, p in own_papers():
        if S.shared_from(p):
            continue
        maps = {}
        for seg in p["audio"]["segments"]:
            if not tail_file(pid, seg["id"]).exists():
                continue
            tq = tail_questions(pid, seg)
            old = seg["lines"]
            new, mapping = [], {}
            for i, l in enumerate(old):
                mapping[i] = len(new)
                if l.get("kind") == "question" and bad_reasons(l["text"]):
                    nums = [int(x) for x in QNUM.findall(l["text"])]
                    # 一行并着两题 "Question 17. … | 2. …"：题号只认行首那个，再按相邻题号补
                    if len(nums) == 1 and re.search(r"\|\s*\d{1,2}\.", l["text"]):
                        nums.append(nums[0] + 1)
                    if nums and all(n in tq for n in nums):
                        kind = "merged" if len(nums) > 1 else ("bare" if "bare" in bad_reasons(l["text"]) else "other")
                        for n in sorted(nums):
                            nl = dict(l)
                            nl.pop("speaker", None)
                            nl.update(start=tq[n]["start"], end=tq[n]["end"], text=tq[n]["text"])
                            new.append(nl)
                        stat[kind] += 1
                        ex[kind].append((pid, seg["id"], l["text"][:70], " || ".join(tq[n]["text"] for n in sorted(nums))[:140]))
                        continue
                    stat["kept"] += 1
                new.append(l)
            if new != old:
                seg["lines"] = new
                maps[seg["id"]] = mapping
        if maps and not dry:
            S.save_paper(p)
            TL.remap_explain(p, maps, lambda *_: None)
    print("重写读题行：", dict(stat))
    (ROOT / "data" / "cache" / "question-fix-examples.json").write_text(json.dumps(ex, ensure_ascii=False, indent=1), "utf-8")


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["scan", "punct", "tail", "apply"])
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    if a.cmd == "scan":
        scan()
    elif a.cmd == "punct":
        punct(a.dry)
    elif a.cmd == "tail":
        tail(set(a.ids))
    else:
        apply(a.dry)


if __name__ == "__main__":
    main()
