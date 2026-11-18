"""听力原文检查和清洗（docs/设计任务-I轮补-逐句原文规范.md §2）。

按录音去重：第 3 套接来的听力（试卷 JSON 的 shared）不单算，修源套后用 listen_locate.py sync 同步。

  python -I scripts/transcript_lint.py lint [id ...]        检查，写 data/cache/transcript-lint.json，打印一行汇总
  python -I scripts/transcript_lint.py fix [id ...] [--dry]  修（§2.2 第 1–5 步）：
      1 标记：没标的读题行标 question、文字统一成 "Question N. 题干"（题号按本段题组校正：Q1o → 10）；没标的题组提示标 cue
      2 拆行：一行里夹着两个人的话按 M:/W: 拆开，时间按词数比例分，填说话人；行首的 M:/W: 前缀去掉、填进 speaker
      3 去符号：² ³ { } [ ] | 和 Ⅰ–Ⅻ 段落标记、句首粘着的单个 I/V（"ISkin" → "Skin"）；A)–D) 开头的选项行整行删掉
      4 拆粘连：不在词典的词，能完全切成常用词才切（doyou → do you、Whenfaced → When faced），只改空格不改字母
      5 补说话人：说话人覆盖不到 80% 的对话段，从解析书原文的 M:/W:/Man:/Woman: 按句对齐填；书里没有的留空
    改了行的段，解析层 locate.line 按行的增删重新映射（删掉的行改按引文重新匹配）。

检查项见 lint() 的注释；"乱句"= 一句里有 2 个以上不在词典的词（或占 30% 以上），乱句 ≥ 3 的段建议重识别。
"""
import argparse
import copy
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAPERS = ROOT / "public" / "papers"
EXPLAIN = PAPERS / "explain"
OUT = ROOT / "data" / "cache" / "transcript-lint.json"
sys.path.insert(0, str(Path(__file__).resolve().parent))


def jload(p):
    return json.loads(Path(p).read_text("utf-8"))


def save_paper(paper):
    (PAPERS / f"{paper['id']}.json").write_text(json.dumps(paper, ensure_ascii=False, indent=2) + "\n", "utf-8")


# ---------- 词典 ----------

_A = None


def A():
    global _A
    if _A is None:
        import align_transcripts as m

        _A = m
    return _A


CONTR = {"t", "s", "re", "ve", "ll", "d", "m"}
SPECIAL_NT = {"won't": "will", "can't": "can", "shan't": "shall", "ain't": "be"}
TOKEN = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)*")


def in_dict(tok):
    """词典里有没有（wouldn't 这类缩写整体认：would + n't）"""
    t = tok.replace("’", "'").lower()
    if t in SPECIAL_NT:
        return True
    if "'" in t:
        base, _, suf = t.partition("'")
        if suf not in CONTR:
            return False
        if suf == "t" and base.endswith("n"):
            base = base[:-1]
        return bool(base) and A().is_word(base)
    return A().is_word(t)


def is_name(tok):
    return tok[:1].isupper() and tok[1:].islower() and len(tok) < 12


def bad_tokens(text):
    return [t for t in TOKEN.findall(text) if len(t) > 2 and not is_name(t) and not in_dict(t)]


# ---------- 段 ----------

def catalog_ids():
    return [x["id"] for x in jload(PAPERS / "index.json") if x["id"].startswith("cet")]


def shared(paper):
    return any(x["section"] == "listening" for x in paper.get("shared") or [])


def segment_groups(paper):
    """{段 id: [题号...]}（按题组顺序）"""
    out = defaultdict(list)
    for s in paper["sections"]:
        if s["kind"] != "listening":
            continue
        for g in s["groups"]:
            if g.get("audioSegment"):
                out[g["audioSegment"]] += [q["number"] for q in g["questions"]]
    return out


def is_conv(seg):
    return seg["id"].startswith("conv") or (seg.get("label") or "").lower().startswith("conversation")


def content(lines):
    return [l for l in lines if not l.get("kind") and (l.get("text") or "").strip()]


OCRNUM = str.maketrans({"o": "0", "O": "0", "l": "1", "I": "1", "i": "1", "S": "5", "s": "5", "Z": "2", "z": "2"})
QLIKE = re.compile(r"^\W*(?:Q(?:uestion)?s?\s*\.?\s*)?([0-9][0-9lIoOSsZz]?|[lI][0-9oO])\s*[;:.,)]\s*([A-Z].*)$")
QUESTION_OK = re.compile(r"^Question (\d+)\.\s")
CUE_LIKE = re.compile(r"^\W*Questions?\s+\S{1,3}\s+(?:and|to|-)\s+\S{1,3}\s+(?:are\s+)?based\s+o\w", re.I)
MARKER = re.compile(r"(?:^|(?<=[\s.?!\"']))(M|W|VV|Man|Woman)\s*[:：;]\s*")
SYMBOLS = re.compile(r"[²³¹{}\[\]|Ⅰ-Ⅻ]")
GLUED_IV = re.compile(r"^(\W*)[IV]\s?(?=[A-Z][a-z])")  # 句首多出来的 I / V（可带空格）后面紧跟大写词
OPTION = re.compile(r"^\W{0,2}[A-D]\)\s*")
CJK = re.compile(r"[一-鿿]")


def qnum(raw):
    t = raw.translate(OCRNUM)
    return int(t) if t.isdigit() else None


def question_candidates(lines):
    """没标 question、但长得像读题的行：[(下标, 题号, 题干)]。只看本段第一个 cue（没有 cue 就是最后一句原文）之后的行"""
    cue_at = next((i for i, l in enumerate(lines) if l.get("kind") == "cue" or CUE_LIKE.match(l.get("text") or "")), None)
    out = []
    for i, l in enumerate(lines):
        if l.get("kind") in ("question", "cue", "directions"):
            continue
        t = (l.get("text") or "").strip()
        m = QLIKE.match(t)
        if not m or "?" not in t[-4:]:
            continue
        strong = bool(re.match(r"^\W*Q", t))  # "Q20;" "Question 7." 开头的不会是原文
        if not strong and ((cue_at is not None and i < cue_at) or (cue_at is None and i < len(lines) - 10)):
            continue
        out.append((i, qnum(m.group(1)), m.group(2).strip()))
    return out


def lint_segment(seg, nums):
    lines = seg.get("lines", [])
    c = content(lines)
    r = {"questionUnmarked": len(question_candidates(lines))}
    have = {int(QUESTION_OK.match(l["text"]).group(1)) for l in lines if l.get("kind") == "question" and QUESTION_OK.match(l.get("text") or "")}
    have |= {int(re.match(r"^Question (\d+)", l["text"]).group(1)) for l in lines if l.get("kind") == "question" and re.match(r"^Question (\d+)", l.get("text") or "")}
    r["questionMissing"] = sorted(set(nums) - have)
    r["cueUnmarked"] = sum(1 for l in lines if l.get("kind") != "cue" and CUE_LIKE.match(l.get("text") or ""))
    if is_conv(seg) and c:
        r["speakerCover"] = round(sum(1 for l in c if l.get("speaker")) / len(c), 2)
    r["twoSpeakers"] = sum(1 for l in c if any(m.start() > 0 for m in MARKER.finditer(l["text"])))
    r["markerPrefix"] = sum(1 for l in c if MARKER.match(l["text"]))
    toks = [t for l in c for t in TOKEN.findall(l["text"])]
    bad = [t for l in c for t in bad_tokens(l["text"])]
    r["words"] = len(toks)
    r["badRate"] = round(len(bad) / len(toks), 3) if toks else 0.0
    r["glued"] = sum(1 for t in bad if len(t) >= 14)
    r["symbols"] = sum(1 for l in c if SYMBOLS.search(l["text"]) or GLUED_IV.match(l["text"]))
    r["cjk"] = sum(1 for l in c if CJK.search(l["text"]))
    r["options"] = sum(1 for l in c if OPTION.match(l["text"]))
    garbled = []
    for l in c:
        bt = bad_tokens(l["text"])
        n = len(TOKEN.findall(l["text"]))
        if len(bt) >= 2 or (n and len(bt) / n >= 0.3 and bt):
            garbled.append(l["text"][:80])
    r["garbled"] = len(garbled)
    r["garbledEx"] = garbled[:3]
    # 时间
    odd = 0
    xs, ys = [], []
    for l in c:
        d = max(0.01, l["end"] - l["start"])
        n = len(TOKEN.findall(l["text"]))
        if n / d > 7 or (d > 3 and n / d < 0.6):
            odd += 1
        xs.append(n)
        ys.append(d)
    r["timeOdd"] = odd
    r["timeCorr"] = round(corr(xs, ys), 2) if len(xs) >= 5 else None
    return r


def corr(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if not sx or not sy:
        return 0.0
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)


def iter_segments(ids):
    for pid in ids:
        p = jload(PAPERS / f"{pid}.json")
        if shared(p) or not p.get("audio"):
            continue
        groups = segment_groups(p)
        for seg in p["audio"]["segments"]:
            if seg["id"] in groups:
                yield pid, p, seg, groups[seg["id"]]


def lint(ids, write=True, quiet=False):
    rows = []
    for pid, p, seg, nums in iter_segments(ids):
        r = lint_segment(seg, nums)
        r.update(id=pid, segment=seg["id"], source=seg.get("source", "book"))
        rows.append(r)
    tot = Counter()
    for r in rows:
        tot["segments"] += 1
        tot["questionUnmarked"] += r["questionUnmarked"]
        tot["questionMissingSegs"] += bool(r["questionMissing"])
        tot["cueUnmarked"] += r["cueUnmarked"]
        tot["convSegs"] += "speakerCover" in r
        tot["speakerLow"] += r.get("speakerCover", 1) < 0.8
        tot["twoSpeakers"] += r["twoSpeakers"]
        tot["markerPrefix"] += r["markerPrefix"]
        tot["glued"] += r["glued"]
        tot["symbols"] += r["symbols"]
        tot["cjk"] += r["cjk"]
        tot["options"] += r["options"]
        tot["garbled"] += r["garbled"]
        tot["garbledSegs3"] += r["garbled"] >= 3
        tot["timeOdd"] += r["timeOdd"]
        tot["timeCorrLow"] += (r["timeCorr"] is not None and r["timeCorr"] < 0.6)
        tot["badTokens"] += round(r["badRate"] * r["words"])
        tot["words"] += r["words"]
    import fix_questions as FQ

    for _, _, seg, _ in iter_segments(ids):
        for l in seg["lines"]:
            if l.get("kind") == "question":
                tot["questionLines"] += 1
                for r in FQ.bad_reasons(l["text"]):
                    tot["q_" + r] += 1
                if FQ.WH.match(FQ.body(l["text"])) and FQ.body(l["text"]).endswith("."):
                    tot["q_period"] += 1
    summary = dict(tot)
    summary["badRate"] = round(tot["badTokens"] / max(1, tot["words"]), 4)
    if write:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps({"summary": summary, "segments": rows}, ensure_ascii=False, indent=1), "utf-8")
    if not quiet:
        print("读题行 {questionLines}：只有题号 {q_bare}，没收尾 {q_trunc}，夹乱码/选项 {q_garb}，并了两题 {q_merged}，疑问句句号 {q_period}".format(**{**{k: 0 for k in ("questionLines", "q_bare", "q_trunc", "q_garb", "q_merged", "q_period")}, **summary}))
        print("段 {segments}（对话 {convSegs}）｜读题没标 {questionUnmarked} 句，读题不全 {questionMissingSegs} 段，cue 没标 {cueUnmarked}｜"
              "说话人 <80% {speakerLow} 段，一行两人 {twoSpeakers}，带 M:/W: 前缀 {markerPrefix}｜粘连长串 {glued}，杂符号 {symbols}，汉字 {cjk}，选项行 {options}｜"
              "乱句 {garbled}（≥3 句的段 {garbledSegs3}）｜生词率 {badRate:.2%}｜时间异常句 {timeOdd}，相关 <0.6 的段 {timeCorrLow}".format(**{**{k: 0 for k in (
                  "segments", "convSegs", "questionUnmarked", "questionMissingSegs", "cueUnmarked", "speakerLow", "twoSpeakers", "markerPrefix", "glued", "symbols", "cjk",
                  "options", "garbled", "garbledSegs3", "timeOdd", "timeCorrLow")}, **summary}))
    return summary, rows


# ---------- 修 ----------

_SPLIT_CACHE = {}
FUNC_START = set("when what how why where who whom whose which the this that these those it its in on at for and but so if as we you they he she i my our your their there here do does did is are was were can could will would should have has had let not now then well yes no oh to of".split())


FUNC_WORDS = FUNC_START | set("him her them me us a an be been being not all any some just very about from with by up out more much many than also only even still too into onto over after before because while until since though although am an or nor yet each every its it's i'm i've i'll you're we're they're don't can't won't isn't".split())
PREFIXES = ("un", "in", "im", "ir", "il", "re", "dis", "non", "over", "under", "out", "mis", "pre", "co", "de", "sub", "inter", "self", "multi", "super", "anti", "counter", "up", "down", "fore", "post", "semi")
SUFFIXES = ("ly", "ness", "ment", "ments", "s", "es", "ed", "d", "ing", "er", "ers", "est", "ful", "less", "able", "ible", "ity", "ism", "ist", "ists", "ize", "ized", "ise", "ised", "al", "ally", "ation", "ations", "ship", "hood", "wise", "ward", "wards")


def derived_word(low):
    """前缀 + 词、词 + 后缀（或两头都有）能还原成词典词：是真词，不当粘连"""
    stems = {low}
    for s in SUFFIXES:
        if low.endswith(s) and len(low) - len(s) >= 3:
            stems.add(low[: -len(s)])
            stems.add(low[: -len(s)] + "e")
    for st in list(stems):
        for p in PREFIXES:
            if st.startswith(p) and len(st) - len(p) >= 3:
                stems.add(st[len(p):])
    stems.discard(low)
    return any(len(s) >= 3 and in_dict(s) and s not in FUNC_START for s in stems)


def split_glued(tok):
    """不在词典的词，能完全切成常用词才切（只加空格）。首字母大写的只在第一块是常见句首词时切（人名地名不拆）"""
    if tok in _SPLIT_CACHE:
        return _SPLIT_CACHE[tok]
    res = tok
    if len(tok) >= 4 and not in_dict(tok) and "'" not in tok and "’" not in tok:
        rk = A().ranks()
        low = tok.lower()
        n = len(low)
        best = [0.0] + [math.inf] * n
        back = [0] * (n + 1)
        for i in range(1, n + 1):
            for j in range(max(0, i - 18), i):
                w = low[j:i]
                r = rk.get(w)
                if r is None or (j == 0 and i == n):  # 整词本身不算一块（thankyou 词频表里有，但要拆）
                    continue
                ln = len(w)
                if (ln == 1 and w not in ("a", "i")) or (ln == 2 and w not in A().SHORT2) or (ln == 3 and r > 8000) or (ln == 4 and r > 25000) or r > 60000:
                    continue
                c = best[j] + math.log(r + 3) + 3.0
                if c < best[i]:
                    best[i], back[i] = c, j
        if not math.isinf(best[n]):
            parts, i = [], n
            while i > 0:
                parts.append(tok[back[i]:i])
                i = back[i]
            parts.reverse()
            ok = len(parts) > 1
            if ok and tok[:1].isupper() and parts[0].lower() not in FUNC_START:
                ok = False
            if ok and derived_word(low):
                ok = False  # insecurely 这类派生词是真词，不拆
            if ok and not any(p.lower() in FUNC_WORDS for p in parts):
                ok = False  # 两个实词拼起来的（mindsets、workplace）多半是复合词，不拆
            if ok and any(p[:1].isupper() for p in parts[1:]) and not tok.isupper():
                ok = False  # 中间有大写字母的（McDonald）不动
            if ok:
                res = " ".join(parts)
    _SPLIT_CACHE[tok] = res
    return res


CUE_PARTS = re.compile(r"^\W*Questions?\s+(\S{1,3})\s+(and|to|-)\s+(\S{1,3})\s+(?:are\s+)?based\s+o\w+\s+(?:the\s+)?(\w+)", re.I)


def norm_cue(t, nums):
    """题组提示统一成卷面写法：Questions 22 to 25 are based on the passage you have just heard."""
    m = CUE_PARTS.match(t)
    if not m:
        return t
    a, b = qnum(m.group(1)), qnum(m.group(3))
    if nums:
        a, b = nums[0], nums[-1]
    what = m.group(4).lower()
    if what not in ("news", "conversation", "passage", "recording", "talk", "lecture", "interview"):
        return t
    if what == "news":
        what = "news report"
    joiner = "and" if b == a + 1 else "to"
    return f"Questions {a} {joiner} {b} are based on the {what} you have just heard."


def restore_l(m):
    """字母中间的 ] | 多半是 l 的识别错（peop]e → people）：还原后是词典词才改，否则原样（后面当杂符号删）"""
    w = m.group()
    fixed = w.replace("]", "l").replace("|", "l")
    return fixed if in_dict(fixed) else w


def fix_token(tok):
    """词里多出来的字母（只在不是词典词、改完是词典词时才改）：
    ① 多一个小写 c（crehearse）；② 开头重复的大写字母（DDistinctions）；③ 大写 I 粘在词后（wishI、SoI）；④ I'm 粘着后一个词（I'mterrified）"""
    if len(tok) < 4 or in_dict(tok) or tok.isupper():
        return tok
    m = re.fullmatch(r"c([a-z]{3,})", tok)
    if m and in_dict(m.group(1)):
        return m.group(1)
    m = re.fullmatch(r"([A-Z])([a-z]{3,})", tok)
    if m and in_dict((m.group(1) + m.group(2)).lower()):
        return m.group(1) + m.group(2)
    m = re.fullmatch(r"(?:I['’]m)([a-z]{3,})", tok)
    if m and in_dict(m.group(1)):
        return tok[:3] + " " + m.group(1)
    m = re.fullmatch(r"([A-Za-z]{2,})I", tok)
    if m and (in_dict(m.group(1)) or is_name(m.group(1))) and m.group(1)[-1].islower():
        return m.group(1) + " I"
    return tok


def fix_text(t, counts):
    """第 3、4 步：去符号、拆粘连。返回新文字"""
    t0 = t
    # 解析书的定位标记整个去掉：[11] [1i] [io] [1il I6]
    t = re.sub(r"\[\s*[0-9A-Za-z]{1,3}\s*[\]\)l|}]?", " ", t)
    t = re.sub(r"(?:(?<=[\s,.;:!?])|^)[I1l]?[0-9]{1,2}[\]\)](?=\s|[A-Za-z])", " ", t)
    t = re.sub(r"\s+([,.;:!?])", r"\1", t)
    t = re.sub(r"[A-Za-z]+[\]|][a-z]+", restore_l, t)
    t = re.sub(r"(^|\s)[IV]?[Ⅰ-Ⅻ]+", r"\1", t)  # 罗马数字段落标记（连同前面粘着的 I：IⅢEnergy）
    t = SYMBOLS.sub(" ", t)
    t = GLUED_IV.sub(r"\1", t)
    t = re.sub(r"\s+", " ", t).strip()
    if t != t0:
        counts["symbols"] += 1
        counts.setdefault("ex_symbols", []).append((t0, t))
    t1 = t
    t = TOKEN.sub(lambda m: fix_token(m.group()), t)
    if t != t1:
        counts["extra"] += 1
        counts.setdefault("ex_extra", []).append((t1, t))
    t1 = t
    t = TOKEN.sub(lambda m: split_glued(m.group()), t)
    if t != t1:
        counts["glued"] += 1
        counts.setdefault("ex_glued", []).append((t1, t))
    return t


def split_two(line, counts):
    """第 2 步：一行里的 M:/W: 拆开；行首前缀去掉、填进 speaker。返回 [新行...]"""
    t = line["text"]
    ms = list(MARKER.finditer(t))
    if not ms:
        return [line]
    pieces = []
    if ms[0].start() > 0:
        pieces.append((line.get("speaker"), t[:ms[0].start()].strip()))
    for k, m in enumerate(ms):
        end = ms[k + 1].start() if k + 1 < len(ms) else len(t)
        who = {"VV": "W", "Man": "M", "Woman": "W"}.get(m.group(1), m.group(1))
        pieces.append((who, t[m.end():end].strip()))
    pieces = [(w, s) for w, s in pieces if re.search(r"[A-Za-z]", s)]
    if not pieces:
        return [line]
    if len(pieces) == 1:
        nl = dict(line, text=pieces[0][1])
        if pieces[0][0]:
            nl["speaker"] = pieces[0][0]
        counts["markerPrefix"] += 1
        counts.setdefault("ex_prefix", []).append((t, nl["text"]))
        return [nl]
    tot = sum(max(1, len(s.split())) for _, s in pieces)
    acc, out = 0, []
    dur = line["end"] - line["start"]
    for w, s in pieces:
        n = max(1, len(s.split()))
        nl = {"start": round(line["start"] + dur * acc / tot, 2), "end": round(line["start"] + dur * (acc + n) / tot, 2), "text": s}
        if w:
            nl["speaker"] = w
        acc += n
        out.append(nl)
    counts["twoSpeakers"] += 1
    counts.setdefault("ex_two", []).append((t, " / ".join(f"{l.get('speaker', '?')}: {l['text']}" for l in out)))
    return out


def fix_segment(seg, nums, book, counts):
    """返回 (新 lines, 旧下标 → 新下标 的映射；删掉的行映射到 None)"""
    lines = seg["lines"]
    asr = seg.get("source") == "asr"
    mapping = {}
    out = []
    cand = {i: (n, stem) for i, n, stem in question_candidates(lines)}
    # 第 1 步：题号按本段题组的顺序校正。已有只写了 "Question N." 的空读题行（按作答停顿标的，时间是对的）：
    # 题干并进那一行，错位的候选行删掉；没有对应空行的候选行原地标成读题
    bare = {}
    for i, l in enumerate(lines):
        m = re.match(r"^Question (\d+)\.?\s*$", l.get("text") or "")
        if l.get("kind") == "question" and m:
            bare[int(m.group(1))] = i
    have = {int(m.group(1)) for l in lines if l.get("kind") == "question" for m in [re.match(r"^Question (\d+)\W*\s[A-Za-z]", l.get("text") or "")] if m}
    missing = [n for n in nums if n not in have]
    order = sorted(cand)
    assign = {}
    if len(order) == len(missing):
        assign = dict(zip(order, missing))
    else:
        for i in order:
            n = cand[i][0]
            if n in missing and n not in assign.values():
                assign[i] = n
    stems_into = {bare[n]: (i, cand[i][1]) for i, n in assign.items() if n in bare}
    drop = {i for i, n in assign.items() if n in bare}
    for i, l in enumerate(lines):
        l = dict(l)
        t = l.get("text") or ""
        if i in drop:
            mapping[i] = None
            continue
        if i in stems_into:
            src, stem = stems_into[i]
            l["text"] = f"{t.strip().rstrip('.')}. {fix_text(stem, Counter()) if not asr else stem}"
            counts["questionMarked"] += 1
            counts.setdefault("ex_question", []).append((lines[src]["text"], l["text"]))
            mapping[i] = len(out)
            out.append(l)
            continue
        if i in assign:
            l["text"] = f"Question {assign[i]}. {fix_text(cand[i][1], Counter()) if not asr else cand[i][1]}"
            l["kind"] = "question"
            l.pop("speaker", None)
            counts["questionMarked"] += 1
            counts.setdefault("ex_question", []).append((t, l["text"]))
            mapping[i] = len(out)
            out.append(l)
            continue
        if l.get("kind") != "cue" and CUE_LIKE.match(t):
            l["kind"] = "cue"
            l.pop("speaker", None)
            l["text"] = norm_cue(t, nums)
            counts["cueMarked"] += 1
            counts.setdefault("ex_cue", []).append((t, l["text"]))
        if l.get("kind"):
            mapping[i] = len(out)
            out.append(l)
            continue
        # 第 3 步：选项行整行删掉
        if OPTION.match(t) or (CJK.search(t) and len(bad_tokens(t)) >= 2):
            counts["optionsDeleted"] += 1
            counts.setdefault("ex_option", []).append((t, "（删掉）"))
            mapping[i] = None
            continue
        parts = split_two(l, counts)
        mapping[i] = len(out)
        for p in parts:
            p["text"] = fix_text(p["text"], counts) if not asr else p["text"]
            if p["text"]:
                out.append(p)
    # 第 5 步：补说话人
    if is_conv(seg) and book is not None:
        c = content(out)
        if c and sum(1 for l in c if l.get("speaker")) / len(c) < 0.8:
            n = fill_speakers(out, book)
            if n:
                counts["speakerFilled"] += n
                counts["speakerSegs"] += 1
    return out, mapping


SPK_RAW = re.compile(r"^(M|W|VV|Man|Woman)\s*[:：;]?$")


def fill_speakers(lines, book):
    """从解析书里找每句原文，往前找最近的 M:/W:/Man:/Woman: 标记。返回补了几句"""
    import asr_listening as S

    n = 0
    for l in lines:
        if l.get("kind") or l.get("speaker"):
            continue
        # 只要定位：这句的词 3 元组在书里投票，至少 3 票（或短句全中）的位置就算找到
        q = S.mwords(l["text"])
        if len(q) < 3:
            continue
        votes = Counter()
        for j in range(len(q) - 2):
            for pos in book.index.get(tuple(q[j:j + 3]), ()):
                votes[pos - j] += 1
        if not votes:
            continue
        off, v = votes.most_common(1)[0]
        if v < min(3, len(q) - 2):
            continue
        s = max(0, off)
        who = None
        for k in range(s - 1, max(-1, s - 250), -1):
            raw = book.toks[k][1]
            if raw == "¦":
                break
            m = SPK_RAW.match(raw.strip()) or re.match(r"^(M|W|VV|Man|Woman)\s*[:：;]", raw.strip())
            if m:
                who = {"VV": "W", "Man": "M", "Woman": "W"}.get(m.group(1), m.group(1))
                break
        if who:
            l["speaker"] = who
            n += 1
    return n


def remap_explain(paper, maps, log=print):
    """改过行的段：解析层 locate.line 按 旧下标 → 新下标 改；删掉的行按引文重新匹配，匹配不上就去掉"""
    import listen_locate as LL

    ep = EXPLAIN / f"{paper['id']}.json"
    if not ep.exists():
        return
    raw = ep.read_bytes()
    layer = json.loads(raw.decode("utf-8"))
    segs = {s["id"]: s for s in paper["audio"]["segments"]}
    moved = lost = 0
    for qid, ent in layer["questions"].items():
        loc = ((ent or {}).get("fields") or {}).get("locate")
        if not isinstance(loc, dict) or not loc.get("line"):
            continue
        sid, idx = loc["line"]["segment"], loc["line"]["index"]
        if sid not in maps:
            continue
        new = maps[sid].get(idx)
        if new is None and loc.get("quote"):
            new, _ = LL.match_quote(loc["quote"], segs[sid]["lines"])
        if new is None:
            del loc["line"]
            lost += 1
        elif new != idx:
            loc["line"] = {"segment": sid, "index": new}
            moved += 1
    LL.save_layer(ep, layer, raw)
    if moved or lost:
        log(f"  解析层 {paper['id']}：行号移动 {moved}，丢失 {lost}")


def fix(ids, dry=False, log=print):
    import asr_listening as S

    counts = Counter()
    papers = defaultdict(dict)
    for pid, p, seg, nums in iter_segments(ids):
        papers[pid][seg["id"]] = (p, seg, nums)
    for pid, segs in papers.items():
        p = next(iter(segs.values()))[0]
        book = None
        if any(is_conv(seg) for _, seg, _ in segs.values()):
            book = S.Book(S.answers_pdf(pid))
        maps = {}
        for sid, (_, seg, nums) in segs.items():
            new, mapping = fix_segment(seg, nums, book, counts)
            if new != seg["lines"]:
                seg["lines"] = new
                maps[sid] = mapping
        if maps and not dry:
            save_paper(p)
            remap_explain(p, maps, log)
        if maps:
            counts["segsChanged"] += len(maps)
            counts["papersChanged"] += 1
    log("改动：" + "，".join(f"{k} {v}" for k, v in counts.items() if not k.startswith("ex_")))
    ex = {k: v for k, v in counts.items() if k.startswith("ex_")}
    (ROOT / "data" / "cache" / "transcript-fix-examples.json").write_text(json.dumps(ex, ensure_ascii=False, indent=1), "utf-8")
    return counts


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["lint", "fix"])
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    ids = a.ids or catalog_ids()
    if a.cmd == "lint":
        lint(ids)
    else:
        fix(ids, dry=a.dry)


if __name__ == "__main__":
    main()
