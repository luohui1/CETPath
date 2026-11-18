"""听力原文重建（2026-11-11）：有问题的段用"语音识别 + 解析书校对"重写（asr_listening.fill），译文按句子相似度搬到新句子上。

哪些段要重写（只看自己有录音的套；第 3 套接来的听力最后用 listen_locate.py sync 同步）：
  - 原文里有扫描垃圾：页边答案字母粘在句首（BMy、cAnd）、两栏串行（wexperiorld.ences）、页眉答案串（11~15 DACDA）、
    正文里的说话人记号（W∶、l-M:）、题目混进正文（Ql:）、乱符号；
  - 读题行只有 "Question 5." 没题干；
  - transcript_lint 报的：词典外的词、粘连、乱码、时间对不上（相关度 < 0.75、时间异常）、缺读题、读题没标出来。
重写要用 data/cache/asr/ 里的识别缓存；没有缓存的段跳过（不在这里跑识别）。

译文：段重写后，新句子没有译文的，到这段旧句子里找词序最像的一句（相似度 ≥ 0.8）搬过来；
旧句子本身就是乱码的，译文是按正确原文翻的，照样能用。

  python -I scripts/transcript_rebuild.py list            列出要重写的段和原因
  python -I scripts/transcript_rebuild.py run [id ...] [--all-asr]    重写（默认全部有毛病的段；--all-asr 连识别重写过的段一起重跑）并搬译文
  python -I scripts/transcript_rebuild.py speakers [id ...]  重写过的对话段重新按文字继承说话人
  python -I scripts/transcript_rebuild.py tidy [id ...]      合成后剩下的小毛病：Q5. 读题、只有题号的读题行、M:、PASSAGE 2、small.change
  python -I scripts/transcript_rebuild.py quotes [id ...]    听力题解析里半句的原文引用换成定位那一整行
  python -I scripts/transcript_rebuild.py pool            trans/<id>.json 里有、总库里没有的听力句译文补进总库
"""
import difflib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import asr_listening as AL  # noqa: E402
import transcript_lint as TL  # noqa: E402
from trans_key import trans_key  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
ROOT = Path(__file__).resolve().parent.parent
PAPERS = ROOT / "public" / "papers"
TRANS = PAPERS / "trans"

NOISE = [
    ("页边字母", re.compile(r"(?:^|[\s\"'(])[A-Da-d](?=[A-Z][a-z]|I\b|I')")),
    ("数字残留", re.compile(r"[A-Za-z][,.]\d\b|^\d+\s+[A-Za-z]|\s\d\s[A-Z]")),
    ("说话人记号", re.compile(r"(?:^|\s)(?:[lI1]-)?(?:M|W|Man|Woman)\s*[:∶：;]")),
    ("题目混入", re.compile(r"^\W*Q[l1I\d]+\s*[:.]")),
    ("两栏串行", re.compile(r"[a-z]\.[a-z]{2,}")),
    ("乱符号", re.compile(r"[∶|¦~^_\\]")),
]


def reasons(seg, lint):
    out = []
    for l in seg.get("lines", []):
        t = l.get("text") or ""
        if l.get("kind") == "directions":
            continue
        n = len(t.split())
        if (l["end"] - l["start"] > 22 and n > 45) or n > 70:
            out.append("超长句")
        if l.get("kind") == "question" and re.fullmatch(r"Question \d+\.?\s*", t):
            out.append("读题没题干")
        for name, r in NOISE:
            if r.search(t):
                out.append(name)
    if lint:
        if (lint.get("badRate") or 0) > 0:
            out.append("词典外的词")
        if lint.get("glued"):
            out.append("粘连")
        if lint.get("garbled"):
            out.append("乱码")
        if (lint.get("timeCorr") or 1) < 0.75 or lint.get("timeOdd"):
            out.append("时间")
        if lint.get("questionMissing") or lint.get("questionUnmarked"):
            out.append("读题")
    return sorted(set(out))


def targets(ids=None, all_asr=False):
    lint = {}
    lf = ROOT / "data" / "cache" / "transcript-lint.json"
    if lf.exists():
        for s in json.loads(lf.read_text("utf-8"))["segments"]:
            lint[(s["id"], s["segment"])] = s
    out = defaultdict(list)
    for pid in ids or AL.catalog_ids():
        p = AL.jload(PAPERS / f"{pid}.json")
        if AL.shared_from(p) or not p.get("audio"):
            continue
        used = {g.get("audioSegment") for s in p["sections"] if s["kind"] == "listening" for g in s["groups"]}
        for s in p["audio"]["segments"]:
            if s["id"] not in used:
                continue
            why = reasons(s, lint.get((pid, s["id"])))
            if all_asr and s.get("source") == "asr" and not why:
                why = ["合成规则改过，重跑"]
            if why:
                out[pid].append((s["id"], why, AL.asr_file(pid, s["id"]).exists()))
    return out


POOL = ROOT / "data" / "cache" / "trans" / "pool.json"  # build_trans.py 的总库：trans/<id>.json 都是从它写出来的


def load_pool():
    return json.loads(POOL.read_text("utf-8")) if POOL.exists() else {}


def save_pool(pool):
    POOL.write_text(json.dumps(pool, ensure_ascii=False, separators=(",", ":")), "utf-8")


def carry_trans(pid, olds, paper, pool):
    """新句子没有译文的，从这段旧句子里找最像的一句搬译文（同时进总库，以后 build_trans.py write 不会丢）。
    返回 (搬了几句, 还缺几句)"""
    f = TRANS / f"{pid}.json"
    if not f.exists():
        return 0, 0
    layer = json.loads(f.read_text("utf-8"))
    sent = layer.setdefault("sentences", {})
    moved = missing = 0
    for seg in paper["audio"]["segments"]:
        if seg["id"] not in olds:
            continue
        old = [(AL.mwords(l.get("text")), sent.get(trans_key(l.get("text") or ""))) for l in olds[seg["id"]]]
        old = [(w, t) for w, t in old if w and t]
        for l in seg["lines"]:
            if l.get("kind") == "directions" or not (l.get("text") or "").strip():
                continue
            k = trans_key(l["text"])
            if k in sent:
                continue
            if k in pool:  # 总库里已经有（别的套译过同一句）
                sent[k] = pool[k]["zh"]
                moved += 1
                continue
            nw = AL.mwords(l["text"])
            best, bt = 0.0, None
            for w, t in old:
                r = difflib.SequenceMatcher(None, nw, w, autojunk=False).ratio()
                if r > best:
                    best, bt = r, t
            if bt and best >= 0.8:
                sent[k] = bt
                pool[k] = {"en": l["text"], "zh": bt}
                moved += 1
            else:
                missing += 1
    f.write_text(json.dumps(layer, ensure_ascii=False, separators=(",", ":")), "utf-8")
    return moved, missing


def speakers(ids=None):
    """识别重写过的对话段，按文字对齐重新从原来的行（data/cache/asr/orig/）继承说话人（asr_listening.speakers_by_text 改过之后补跑）。
    只动 speakerSource 没写过的段（音高补的不动）"""
    n = 0
    for pid in ids or AL.catalog_ids():
        p = AL.jload(PAPERS / f"{pid}.json")
        if AL.shared_from(p) or not p.get("audio"):
            continue
        dirty = False
        for s in p["audio"]["segments"]:
            if s.get("source") != "asr" or s.get("speakerSource") or not TL.is_conv(s):
                continue
            f = AL.ORIG / f"{pid}.{s['id']}.json"
            if not f.exists():
                continue
            got = AL.speakers_by_text(AL.jload(f), s["lines"])
            for i, l in enumerate(s["lines"]):
                if l.get("kind"):
                    continue
                who = got.get(i)
                if who and l.get("speaker") != who:
                    l["speaker"] = who
                    dirty = True
                    n += 1
        if dirty:
            AL.save_paper(p)
    print(f"重新继承说话人：改了 {n} 句")


def quotes(ids=None):
    """听力题解析的"原文"引用（locate.quote）是半句（"The father is planning to change his"）而定位那一行是整句的：
    引用换成整行原文（≤40 词）。引用的词按顺序都在那一行里才换"""
    import listen_locate as LL

    n = 0
    for pid in ids or AL.catalog_ids():
        p = AL.jload(PAPERS / f"{pid}.json")
        ep = LL.EXPLAIN / f"{pid}.json"
        if not p.get("audio") or not ep.exists():
            continue
        raw = ep.read_bytes()
        layer = json.loads(raw.decode("utf-8"))
        segs = {s["id"]: s for s in p["audio"]["segments"]}
        dirty = False
        for q in layer.get("questions", {}).values():
            loc = (q.get("fields") or {}).get("locate") or {}
            ln = loc.get("line")
            if not ln or not loc.get("quote") or ln.get("segment") not in segs:
                continue
            lines = segs[ln["segment"]]["lines"]
            if not 0 <= ln.get("index", -1) < len(lines):
                continue
            text = lines[ln["index"]]["text"].strip()
            qw, tw = AL.mwords(loc["quote"]), AL.mwords(text)
            if not qw or len(tw) > 40 or len(qw) >= len(tw) or loc["quote"].strip() == text:
                continue
            sm = difflib.SequenceMatcher(None, qw, tw, autojunk=False)
            if sum(b.size for b in sm.get_matching_blocks()) >= len(qw) - 1:
                loc["quote"] = text
                dirty = True
                n += 1
        if dirty:
            LL.save_layer(ep, layer, raw)
    print(f"引用补成整句：{n} 题")


QPREFIX = re.compile(r"^Q\s?(\d{1,2})\s*[.:：]\s*(.*)$")
QNODOT = re.compile(r"^Question (\d{1,2})\s+(?=[A-Z])")
HEADING = re.compile(r"^(?:[BP]ASSAGE|SECTION|PART)\s+\w+\s+", re.I)
GLUED = re.compile(r"(?<![wW]{3})(?<=[a-z])\.(?=[a-z]{2,}\b)(?!(?:com|org|net|edu|gov|co)\b)")


def tidy(ids=None):
    """识别 + 解析书合成以后还剩的几类小毛病（逐行改，译文跟着搬到新句子上）：
    - 书里的读题写法 "Q5. …" "Q16:…" → "Question 5. …"，标成读题；"Question 9 What…" 补句点；读题首字母大写
    - 只有 "Question 2." 的读题行：后面紧跟的那句（问号结尾、10 秒内）是题干，并进来
    - 正文里残留的说话人记号 "M:" "W:"、段标题 "PASSAGE 2"、书里两词粘着的句点（small.change）"""
    pool = load_pool()
    n = 0
    for pid in ids or AL.catalog_ids():
        p = AL.jload(PAPERS / f"{pid}.json")
        if AL.shared_from(p) or not p.get("audio"):
            continue
        tf = TRANS / f"{pid}.json"
        layer = json.loads(tf.read_text("utf-8")) if tf.exists() else {"sentences": {}}
        sent = layer.setdefault("sentences", {})
        dirty = False
        olds = {}  # 合并过行的段：旧行（行号变了，解析层的答案句要重挂）
        nums_of = TL.segment_groups(p)
        for s in p["audio"]["segments"]:
            lines = s["lines"]
            before = [dict(x) for x in lines]
            # 识别在读题那段偶尔幻听（"Thank you for watching."）、整段读题漏掉：删幻听句，缺的读题行从重写前的原文里取回
            keep = [l for l in lines if not re.fullmatch(r"(?i)(thank you|thanks) for watching\.?|in\.", (l.get("text") or "").strip())]
            have = {int(m.group(1)) for l in keep if (m := re.match(r"^Questions? (\d+)\b", l.get("text") or "")) and l.get("kind") == "question"}
            missing = [qn for qn in nums_of.get(s["id"], []) if qn not in have]
            of = AL.ORIG / f"{pid}.{s['id']}.json"
            if missing and of.exists() and s.get("source") == "asr":
                orig = AL.jload(of)
                for qn in missing:
                    q = next((dict(x) for x in orig if x.get("kind") == "question" and re.match(rf"^Question {qn}\.\s+\S", x.get("text") or "")), None)
                    if q and not any(abs(q["start"] - x["start"]) < 1 for x in keep):
                        keep.append(q)
                if not any(x.get("kind") == "cue" for x in keep):
                    cue = next((dict(x) for x in orig if x.get("kind") == "cue"), None)
                    if cue:
                        keep.append(cue)
                keep.sort(key=lambda x: x["start"])
            if len(keep) != len(lines) or [x.get("text") for x in keep] != [x.get("text") for x in lines]:
                olds[s["id"]] = before
                dirty = True
                n += abs(len(keep) - len(lines)) or 1
            lines = keep
            out = []
            for l in lines:
                t0 = t = l.get("text") or ""
                # 没标出来的读题、题组提示（题组提示被截成 "Questions 1 and 2"，后面的读题就没认出来）
                if not l.get("kind") and re.match(r"^Question \d{1,2}\. [A-Z].*\?$", t):
                    l["kind"] = "question"
                    dirty = True
                if not l.get("kind") and re.fullmatch(r"Questions? \d{1,2} (?:and|to) \d{1,2}\.?", t):
                    l["kind"] = "cue"
                    dirty = True
                if l.get("kind") != "directions":
                    m = QPREFIX.match(t)
                    if m and m.group(2):
                        t = f"Question {m.group(1)}. {m.group(2)}"
                        l["kind"] = "question"
                    t = QNODOT.sub(lambda m: f"Question {m.group(1)}. ", t)
                    if l.get("kind") == "question":
                        t = re.sub(r"^(Question \d+\. )([a-z])", lambda m: m.group(1) + m.group(2).upper(), t)
                    t = re.sub(r"(?:^|(?<=[\s?.!]))[MW]\s*[:：]\s*", "", t) if not l.get("kind") else t
                    t = HEADING.sub("", t) if not l.get("kind") else t
                    t = GLUED.sub(" ", t)
                    t = re.sub(r"(?<=[a-z]),(?=[A-Za-z])", ", ", t)  # 逗号后面少空格（"efforts,we"）
                # 只有题号的读题行 + 紧跟的另一条读题行（书里的题号有时印错：25 印成 5）：并成一行，题号以单独那行为准
                bare = out and out[-1].get("kind") == "question" and re.fullmatch(r"Question (\d+)\.?\s*", out[-1]["text"])
                if bare and l.get("kind") == "question" and l["start"] - out[-1]["end"] < 3:
                    head = out[-1]
                    t = re.sub(r"^Question \d+\.", f"Question {bare.group(1)}.", t)
                    head["text"] = t
                    head["end"] = l["end"]
                    k = trans_key(t0)
                    if k in sent:
                        sent[trans_key(t)] = sent[k]
                    n += 1
                    dirty = True
                    olds[s["id"]] = before
                    continue
                # 只有题号的读题行 + 紧跟的题干
                if out and out[-1].get("kind") == "question" and re.fullmatch(r"Question \d+\.?\s*", out[-1]["text"]) and not l.get("kind") and t.rstrip().endswith("?") and l["start"] - out[-1]["end"] < 10:
                    head = out[-1]
                    old_head = head["text"]
                    head["text"] = head["text"].rstrip(". ") + ". " + t
                    head["end"] = l["end"]
                    k = trans_key(t0)
                    if k in sent:
                        sent[trans_key(head["text"])] = sent[k]
                    n += 1
                    dirty = True
                    olds[s["id"]] = before
                    continue
                if t != t0:
                    l["text"] = t
                    k0, k1 = trans_key(t0), trans_key(t)
                    if k0 in sent and k1 not in sent:
                        sent[k1] = sent[k0]
                        pool.setdefault(k1, {"en": t, "zh": sent[k0]})
                    n += 1
                    dirty = True
                out.append(l)
            fixed = question_zone(out, nums_of.get(s["id"], []))
            if fixed is not None:
                out = fixed
                olds[s["id"]] = before
                dirty = True
                n += 1
            s["lines"] = out
        if dirty:
            AL.save_paper(p)
            if olds:
                AL.relink(p, olds)
            if tf.exists():
                tf.write_text(json.dumps(layer, ensure_ascii=False, separators=(",", ":")), "utf-8")
    save_pool(pool)
    print(f"整理了 {n} 行")


WH = re.compile(r"^(What|Why|How|Where|When|Who|Whom|Whose|Which|According|In what|For what)\b")


def question_zone(lines, nums):
    """一段的读题区（最后一个题组提示 "Questions 12 to 15 are based on…" 之后）理顺；没改动返回 None：
    - 提示之前标成读题的行是正文（讲话里念到的小测验题 "Question 1. Where must you…"），去掉标记；
    - "Question fourteen." 写成数字；只有题号的一行（后面 5 秒内还有读题）去掉；
    - 没带题号的题干：和上一条读题一样的是重复，去掉；不一样的补上下一个还没出现的题号"""
    cue = max((i for i, l in enumerate(lines) if l.get("kind") == "cue"), default=None)
    if cue is None or not nums:
        return None
    out = [dict(l) for l in lines]
    changed = False
    for l in out[:cue]:
        if l.get("kind") == "question":
            del l["kind"]
            changed = True
    used = set()
    res = out[: cue + 1]
    tail = out[cue + 1:]
    for k, l in enumerate(tail):
        t = (l.get("text") or "").strip()
        m = re.match(r"^Question ([A-Za-z-]+|\d{1,2})[.:]?\s*(.*)$", t)
        if m and not m.group(1).isdigit():
            num = AL.num(m.group(1))
            if num is not None:
                t = f"Question {num}." + (f" {m.group(2)}" if m.group(2) else "")
                l["text"] = t
                changed = True
                m = re.match(r"^Question (\d{1,2})[.:]?\s*(.*)$", t)
        if m and m.group(1).isdigit():
            nxt = tail[k + 1] if k + 1 < len(tail) else None
            if not m.group(2) and nxt and nxt["start"] - l["end"] < 5:
                changed = True  # 只有题号，后面紧跟着题干
                continue
            used.add(int(m.group(1)))
            if l.get("kind") != "question":
                l["kind"] = "question"
                changed = True
            if not t.startswith(f"Question {m.group(1)}. "):
                l["text"] = f"Question {m.group(1)}. {m.group(2)}"
                changed = True
            res.append(l)
            continue
        if not l.get("kind") and (t.endswith("?") or WH.match(t)):
            prev = res[-1] if res else None
            stem = re.sub(r"^Question \d+\.\s*", "", (prev or {}).get("text") or "")
            if prev and prev.get("kind") == "question" and difflib.SequenceMatcher(None, AL.mwords(stem), AL.mwords(t)).ratio() >= 0.8:
                changed = True  # 和上一条读题重复
                continue
            left = [q for q in nums if q not in used]
            if left:
                l["text"] = f"Question {left[0]}. {t}"
                l["kind"] = "question"
                used.add(left[0])
                changed = True
        res.append(l)
    return res if changed else None


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    ids = [x for x in sys.argv[2:] if not x.startswith("--")] or None
    if cmd == "tidy":
        tidy(ids)
        return
    if cmd == "speakers":
        speakers(ids)
        return
    if cmd == "quotes":
        quotes(ids)
        return
    # --all-asr：识别重写过的段不管有没有毛病都重跑一遍（合成规则改过以后用）
    t = targets(ids, all_asr="--all-asr" in sys.argv)
    if cmd == "list":
        n = sum(len(v) for v in t.values())
        nc = sum(1 for v in t.values() for _, _, c in v if c)
        print(f"{len(t)} 套、{n} 段要重写（有识别缓存的 {nc} 段）")
        for pid, segs in t.items():
            for sid, why, c in segs:
                print(f"  {pid} {sid}{'' if c else '（没缓存）'}：{'、'.join(why)}")
        return
    if cmd == "pool":
        # 第一次跑时搬的译文只写进了 trans/<id>.json：补进总库
        pool = load_pool()
        n = 0
        for f in sorted(TRANS.glob("*.json")):
            p = PAPERS / f.name
            if not p.exists():
                continue
            paper = AL.jload(p)
            en = {trans_key(l["text"]): l["text"] for s in (paper.get("audio") or {}).get("segments", []) for l in s["lines"] if (l.get("text") or "").strip()}
            for k, zh in json.loads(f.read_text("utf-8")).get("sentences", {}).items():
                if k not in pool and k in en:
                    pool[k] = {"en": en[k], "zh": zh}
                    n += 1
        save_pool(pool)
        print(f"补进总库 {n} 句")
        return
    pool = load_pool()
    tot_moved = tot_missing = 0
    for pid, segs in t.items():
        sids = [sid for sid, _, c in segs if c]
        if not sids:
            continue
        before = AL.jload(PAPERS / f"{pid}.json")
        olds = {s["id"]: s["lines"] for s in before["audio"]["segments"] if s["id"] in sids}
        rep = AL.fill(pid, sids)
        if not rep:
            continue
        after = AL.jload(PAPERS / f"{pid}.json")
        moved, missing = carry_trans(pid, {sid: olds[sid] for sid, *_ in rep}, after, pool)
        tot_moved += moved
        tot_missing += missing
        print(f"  {pid}：译文搬了 {moved} 句，还缺 {missing} 句")
        save_pool(pool)
    print(f"译文共搬 {tot_moved} 句，还缺 {tot_missing} 句（交给 build_trans.py 补）")


if __name__ == "__main__":
    main()
