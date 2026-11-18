"""听力缺段补原文（本地语音识别 + 解析书校对）、整段录音切成题组。设计见 docs/设计任务-I轮-听力与译文与小窗.md §1。

只改试卷 JSON 的 audio 字段（整段录音切题组时另外补题组的 audioSegment）；题目、答案、解析、卷面定位都不动。

识别：faster-whisper medium.en（int8、CPU、一次只跑一个进程），模型放在 data/cache/whisper/，录音不上传。
      每段的识别结果（词级时间戳）缓存在 data/cache/asr/<id>.<段>.json，重跑不再识别。

出原文（一段）：
  1. 识别结果按句号、问号、叹号切句；"Question 3." 和后面的题干合成一行；每句的起止取首词、末词的时间。
  2. 解析书校对：在这一套的解析 PDF 全文里找和这句最像的一句（词的 3 元组定位 + 逐词比对，词重合 ≥ 0.85，
     而且书里那句的词能在识别结果里一一对上）。找到了、书里那段是可用的文字层（不是扫描识别）就用书里的原文，
     否则用识别的原文。选项不会读出来，所以书里混排的带中文选项天然对不上，不会被当成原文。
  3. 每句按固定说法标 kind（directions / cue / question，同 align_transcripts.classify），原文不标。
  4. 段上标 "source": "asr"（时间和切句来自识别；有几句的文字取自解析书的，另记 "bookLines": n）。

  python -I scripts/asr_listening.py transcribe <id> [段 ...]      只识别（缓存），不写试卷；段可写 all（整份录音）
  python -I scripts/asr_listening.py show <id> <段>                  打印这段识别 + 校对后的每一句（不写）
  python -I scripts/asr_listening.py fill <id> [段 ...]              给这些段写原文（默认：没有原文、或原文 ≤ 2 句的段）
  python -I scripts/asr_listening.py split <id>                      整段录音（只有一个 all 段）按题组切开，并写原文
  python -I scripts/asr_listening.py todo                            列出目录里还要补的段
  python -I scripts/asr_listening.py review [id ...]                 识别补出的段逐段核对（读题号、cue、原文里有没有选项样式/汉字、首末句）
"""
import argparse
import copy
import difflib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAPERS = ROOT / "public" / "papers"
AUDIO = ROOT / "public"
ASR = ROOT / "data" / "cache" / "asr"
MODEL = ROOT / "data" / "cache" / "whisper" / "faster-whisper-medium.en"
THREADS = 10  # 单进程多线程（不加内存）；一次只跑一个识别进程

sys.path.insert(0, str(Path(__file__).resolve().parent))


def jload(p):
    return json.loads(Path(p).read_text("utf-8"))


def save_paper(paper):
    (PAPERS / f"{paper['id']}.json").write_text(json.dumps(paper, ensure_ascii=False, indent=2) + "\n", "utf-8")


# ---------- 识别 ----------

_model = None


def model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        _model = WhisperModel(str(MODEL), device="cpu", compute_type="int8", cpu_threads=THREADS, num_workers=1)
    return _model


def asr_file(pid, sid):
    return ASR / f"{pid}.{sid}.json"


def transcribe(paper, sid, log=print):
    """识别一段（sid=all 是整份录音），返回 {"start", "end", "words": [[s, e, w, p], ...]}（时间是整份录音里的秒数）"""
    pid = paper["id"]
    f = asr_file(pid, sid)
    if f.exists():
        return jload(f)
    a = paper["audio"]
    if sid == "all":
        start, end = 0.0, float(a["duration"])
    else:
        seg = next(s for s in a["segments"] if s["id"] == sid)
        start, end = float(seg["start"]), float(seg["end"])
    mp3 = AUDIO / a["src"].lstrip("/")
    # 段前后各多留 1 秒，免得切掉开头结尾的词
    s0 = max(0.0, start - 1.0)
    s1 = min(float(a["duration"]), end + 1.0)
    with tempfile.TemporaryDirectory() as td:
        wav = Path(td) / "seg.wav"
        # -nostdin：在 while read 循环里跑时别把循环的输入吃掉
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", f"{s0:.2f}", "-to", f"{s1:.2f}", "-i", str(mp3), "-ac", "1", "-ar", "16000", str(wav)],
                       check=True, stdin=subprocess.DEVNULL)
        t0 = time.time()
        segs, info = model().transcribe(
            str(wav), language="en", beam_size=5, word_timestamps=True, condition_on_previous_text=False,
            vad_filter=True, vad_parameters={"min_silence_duration_ms": 600},
        )
        words = []
        for sg in segs:
            for w in sg.words or []:
                words.append([round(w.start + s0, 2), round(w.end + s0, 2), w.word, round(w.probability, 3)])
    out = {"id": pid, "segment": sid, "start": start, "end": end, "model": MODEL.name, "words": words}
    ASR.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), "utf-8")
    log(f"  识别 {pid} {sid}：{end - start:.0f} 秒录音，用了 {time.time() - t0:.0f} 秒，{len(words)} 个词")
    return out


# ---------- 切句 ----------

END = re.compile(r"[.?!][\"')\]]*$")
ABBR = {"mr.", "mrs.", "ms.", "dr.", "prof.", "st.", "jr.", "sr.", "vs.", "u.s.", "a.m.", "p.m.", "e.g.", "i.e.", "u.k.", "inc.", "co.", "ltd."}


# ---------- 解析书 ----------

def mwords(t):
    t = (t or "").replace("’", "'").replace("‘", "'").lower().replace("'", "")
    return re.findall(r"[a-z0-9]+", t)


class Book:
    """一套解析 PDF 的全文（英文词流）：每个词记 (规范化的词, 原样, 页, 是否文字层)"""

    def __init__(self, pdf):
        import align_transcripts as A
        import cet_ocr

        self.toks = []
        self.ok = False
        if not pdf or not Path(pdf).exists():
            return
        src = A.PageSource(pdf, allow_ocr=False)
        for i in range(src.n):
            page = src.doc[i]
            layer = A.text_usable(cet_ocr.text_lines(page))
            rows = src.lines(i) or []
            for r in rows:
                text = A.CJK.sub(" ¦ ", r["text"])  # 汉字处断开（选项译文、答案详解）
                for raw in text.split():
                    if raw == "¦":
                        self.toks.append(("¦", "¦", i + 1, layer))
                        continue
                    for n in mwords(raw) or []:
                        self.toks.append((n, raw, i + 1, layer))
                        raw = ""  # 一个原样 token 拆出几个词时，原样只挂在第一个上
        self.norm = [t[0] for t in self.toks]
        self.index = defaultdict(list)
        for i in range(len(self.norm) - 2):
            self.index[tuple(self.norm[i:i + 3])].append(i)
        self.ok = bool(self.toks)

    def find(self, text):
        """这句在书里最像的一段：返回 (重合度, 起, 止, 全在文字层)；没有返回 None"""
        q = mwords(text)
        if len(q) < 4 or not self.ok:
            return None
        votes = Counter()
        for j in range(len(q) - 2):
            for p in self.index.get(tuple(q[j:j + 3]), ()):
                votes[p - j] += 1
        if not votes:
            return None
        best = None
        for off, _ in votes.most_common(3):
            a, b = max(0, off - 3), min(len(self.norm), off + len(q) + 3)
            window = self.norm[a:b]
            sm = difflib.SequenceMatcher(None, q, window, autojunk=False)
            blocks = [m for m in sm.get_matching_blocks() if m.size]
            if not blocks:
                continue
            hit = sum(m.size for m in blocks)
            s, e = a + blocks[0].b, a + blocks[-1].b + blocks[-1].size  # 书里对上的首词到末词
            span = e - s
            if "¦" in self.norm[s:e]:
                continue
            # 首尾词都要对上（书里那句是残句、开头被定位标记吃掉的，不用）
            if blocks[0].a != 0 or blocks[-1].a + blocks[-1].size != len(q):
                continue
            score = min(hit / len(q), hit / max(1, span))  # 两个方向都要像：识别的词在书里、书里这段的词在识别里
            if not best or score > best[0]:
                best = (score, s, e, all(t[3] for t in self.toks[s:e]))
        return best

    def surface(self, s, e):
        return " ".join(t[1] for t in self.toks[s:e] if t[1])


def answers_pdf(pid):
    import import_cet

    info = import_cet.discover().get(pid)
    return info.get("answers") if info else None


# ---------- 读题、指导语 ----------

NUMW = {w: i for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split())}
NUMW.update({f"twenty-{w}": 20 + i for w, i in list(NUMW.items())[1:10]})
NUMW.update({f"twenty {w}": 20 + i for w, i in list(NUMW.items())[1:10]})
_NUM = r"(\d{1,2}|" + "|".join(sorted((re.escape(k) for k in NUMW), key=len, reverse=True)) + r")"
Q_RE = re.compile(r"^(?:Question\s+|Q\.?\s*)" + _NUM + r"\b\W*", re.I)  # Whisper 偶尔写成 "Q5."
CUE_RE = re.compile(r"^Questions?\s+" + _NUM + r"\s+(and|to)\s+" + _NUM + r"\s+(?:are\s+)?based\s+on\s+(?:the\s+)?(.*)$", re.I)
HEAD_RE = re.compile(r"^(News\s+Report|Conversation|Passage|Recording|Lecture|Talk)\s+(One|Two|Three|Four|[1-4])\b[.,:]?", re.I)
ORDW = {"1": "One", "2": "Two", "3": "Three", "4": "Four"}
EXTRA_DIR = [re.compile(p, re.I) for p in (
    r"^College English Test\b",
    r"^Directions\W*$",
    r"^Part\s+(?:II|2|Two)\W+Listening Comprehension\b",
    r"^(?:Part\s+(?:II|2|Two)\W+)?Listening Comprehension\W*(?:Section\s+[ABC]\W*)?(?:Directions\W*)?$",
    r"^Section\s+[ABC]\W*(?:Directions\W*)?$",
    r"^(?:Section\s+[ABC]\W+)?(?:Directions\W+)?In this section,? you(?:'ll|’ll|\s+will)\s+hear\b",
    r"^At the end of (?:each|the) \w+(?: \w+)?,? you(?:'ll|’ll|\s+will)\s+hear\b",
    r"^Both the \w+(?: \w+)? and the questions will be spoken only once",
    r"^After you hear a question,? you must choose the best answer",
    r"^Then,? mark the corresponding letter\b",
    r"^This is the end of (?:the )?listening comprehension",
)]


def num(tok):
    tok = tok.lower().replace("-", " ") if not tok.isdigit() else tok
    return int(tok) if tok.isdigit() else NUMW.get(tok, NUMW.get(tok.replace(" ", "-")))


def tidy(text):
    """读题、读题提示改成卷面写法（数字），返回 (文字, kind)"""
    import align_transcripts as A

    t = text.strip()
    m = CUE_RE.match(t)
    if m:
        a, b = num(m.group(1)), num(m.group(3))
        rest = m.group(4).strip()
        if not re.match(r"(?i)(?:the|this)\b", rest):
            rest = "the " + rest
        return f"Questions {a} {m.group(2).lower()} {b} are based on {rest}", "cue"
    m = Q_RE.match(t)
    if m:
        n = num(m.group(1))
        rest = t[m.end():].strip()
        return (f"Question {n}. {rest}" if rest else f"Question {n}."), "question"
    m = HEAD_RE.match(t)
    if m and len(t) - m.end() <= 1:
        w = m.group(2)
        return f"{' '.join(x.capitalize() for x in m.group(1).split())} {ORDW.get(w, w.capitalize())}.", "directions"
    if any(r.search(t) for r in EXTRA_DIR):
        return t, "directions"
    k = A.classify(t)
    return t, k


ABBR_END = re.compile(r"(?:\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|Inc|Ltd|Co|Mt)|\b(?:[A-Za-z]\.){1,3}[A-Za-z])\.$")


def split_words(ws):
    """词 → 句（词的列表）：. ? ! 断句（缩写后不断），停顿超过 2.5 秒断句，段标题（News Report One）单独一句"""
    def phantom(i):
        """概率极低、而且自成一句（"questions."）或前后都隔着长停顿的词，多半是停顿里冒出来的幻听；
        段首的 "A recent study" 这种概率低但后面紧跟小写词的是真话，留着"""
        w = ws[i]
        if w[3] >= 0.1 or not w[2].strip():
            return False
        if END.search(w[2].strip()):
            return True
        gap_prev = w[0] - ws[i - 1][1] if i > 0 else 99
        gap_next = ws[i + 1][0] - w[1] if i + 1 < len(ws) else 99
        return gap_prev > 2.5 and gap_next > 2.5

    ws = [list(w) for i, w in enumerate(ws) if not phantom(i)]
    for i in range(len(ws) - 1):
        # Whisper 偶尔把读题的 "Question" 时间戳放到作答停顿之前，挪到题号前面
        # （偶尔还听成复数 "Questions"，一并改回单数）
        if ws[i][2].strip().lower().rstrip(".,") in ("question", "questions") and ws[i + 1][0] - ws[i][1] > 2.5 and num(ws[i + 1][2].strip().rstrip(".,:")) is not None:
            ws[i][0], ws[i][1] = round(ws[i + 1][0] - 0.6, 2), round(ws[i + 1][0] - 0.05, 2)
            ws[i][2] = " Question"
    sents, cur = [], []
    for i, w in enumerate(ws):
        tok = w[2].strip()
        if not tok:
            continue
        if cur and w[0] - cur[-1][1] > 2.5:
            sents.append(cur)
            cur = []
        # 读题提示和读题（"Questions 22 to 25 are based on…"、"Question 22."）一定另起一句：Whisper 偶尔不打标点，会粘进上一句
        nxt = ws[i + 1][2].strip().rstrip(".,:") if i + 1 < len(ws) else ""
        if cur and tok.lower().rstrip(".,") in ("question", "questions") and num(nxt) is not None:
            sents.append(cur)
            cur = []
        # 读题提示到 "heard" 为止（后面紧跟 "Question N"）
        if cur and tok[:1] != "" and cur[-1][2].strip().lower().rstrip(".,") == "heard" and "based on" in "".join(x[2] for x in cur).lower():
            sents.append(cur)
            cur = []
        cur.append(w)
        text = "".join(x[2] for x in cur).strip()
        if END.search(tok) and not ABBR_END.search(text):
            sents.append(cur)
            cur = []
    if cur:
        sents.append(cur)
    out = []
    for s in sents:
        text = "".join(x[2] for x in s).strip()
        m = HEAD_RE.match(text)
        if m and m.end() < len(text) - 2:
            n = len(m.group(0).split())
            out += [s[:n], s[n:]]
        else:
            out.append(s)
    return [p for s in out for p in split_long(s)]


LONG_WORDS = 30


def split_long(s):
    """Whisper 偶尔整段不打标点（一"句"五十多秒、两个人的话连在一起）：超过 30 个词的句子在词间停顿最长处切开，
    直到每块都不超过 30 词。干净的考试录音里，最长的停顿基本就是换句、换人的地方"""
    if len(s) <= LONG_WORDS:
        return [s]
    gaps = [(s[i][0] - s[i - 1][1], i) for i in range(5, len(s) - 4)]
    if not gaps:
        return [s]
    g, i = max(gaps)
    if g < 0.15:
        return [s]
    return split_long(s[:i]) + split_long(s[i:])


def segment_lines(words, lo, hi, book=None, prev_kind0=None):
    """一段的句子行：[{start, end, text, kind?}]，以及从书里取了几句"""
    ws = [w for w in words if lo - 0.3 <= (w[0] + w[1]) / 2 <= hi + 0.3]
    rows = []
    for s in split_words(ws):
        text = re.sub(r"\s+", " ", "".join(w[2] for w in s)).strip()
        if not re.search(r"[A-Za-z]", text) and not re.fullmatch(r"\d{1,2}\.?", text):  # 单独的题号留着，下面和题干合并
            continue
        # 长句在停顿处切开的块（split_long）没有句末标点：补一个句号
        if len(s) >= 6 and not re.search(r"[.?!][\"')\]]*$", text):
            text = text.rstrip(",;:") + "."
        rows.append({"start": max(lo, s[0][0]), "end": min(hi, s[-1][1]), "text": text})
    # "Question 3." 单独成句：和后面的题干合成一行。老录音（2015 年前后）有时只识别出题号 "9."，同样处理，补成 "Question 9."
    merged = []
    for r in rows:
        last = merged[-1]["text"] if merged else ""
        lone_q = bool(Q_RE.match(last)) and not last[Q_RE.match(last).end():].strip()
        bare = re.fullmatch(r"(\d{1,2})\.?", last)
        if merged and (lone_q or bare) and r["start"] - merged[-1]["end"] < 3.5 and re.match(r"[A-Z]", r["text"]):
            head = f"Question {bare.group(1)}" if bare else last.rstrip(". ")
            merged[-1]["text"] = head + ". " + r["text"]
            merged[-1]["end"] = r["end"]
            continue
        merged.append(r)
    n_book = 0
    out = []
    prev_kind = prev_kind0
    for r in merged:
        text, kind = tidy(r["text"])
        # 读题只出现在"Questions X to Y are based on…"之后、一题接一题；讲座里说的"Question one: …"是原文
        if kind == "question" and prev_kind not in ("cue", "question"):
            text, kind = r["text"], None
        prev_kind = kind
        from_book = False
        if kind is None and book is not None:
            hit = book.find(text)
            if hit and hit[0] >= 0.9:
                bt = clean_book(book.surface(hit[1], hit[2]))
                # 撇号不能比识别结果少（书里 "Id been" 顶替不了 "I'd been"）；
                # 词也不能比识别结果少（书里常丢句首的词："Is one way to…" 少了 It）
                if bt and book_words_ok(text, bt) and apostrophes(bt) >= apostrophes(text) and len(mwords(bt)) >= len(mwords(text)):
                    text = bt
                    n_book += 1
                    from_book = True
        if text[:1].islower() and not re.match(r"^[a-z]+[A-Z]", text):  # 段标题后 Whisper 偶尔不大写（iPhone 这种不动）
            text = text[0].upper() + text[1:]
        line = {"start": round(r["start"], 2), "end": round(r["end"], 2), "text": text}
        if kind:
            line["kind"] = kind
        if from_book:
            line["_book"] = True  # 只在切段时数句数用，写文件前去掉
        out.append(line)
    return out, n_book


def strip_marks(lines):
    n = sum(1 for l in lines if l.pop("_book", False))
    return n


def book_words_ok(asr_text, book_text):
    """书里那句和识别结果不一样的词，只容许数字和大写开头的专名（书里的人名地名拼写更可靠）；
    小写词不一样多半是书的识别错字（bllSY、cearning，以及 but→bat 这种词典里也有的），这句就用识别原文"""
    import align_transcripts as A

    heard = set(w[:7] for w in mwords(asr_text))
    for raw in re.findall(r"[A-Za-z0-9'’-]+", book_text):
        cap = raw[:1].isupper()
        for w in mwords(raw):
            if w[:7] in heard:
                continue
            # 识别里没有的数字：多半是书页边的题号、答案标记（"from here,5 but"），这句不用书里的
            if w.isdigit():
                return False
            if not cap or not A.is_word(w) and len(w) < 3:
                return False
    return True


BAD_BOOK = re.compile(r"[\[\]【】()（）~～|¦■●□]|\b\d+[A-Za-z]{1,2}\b|\b[A-D]{3,}\b|^\W*\d|[.;:,]\s*[.;:,]|\.\s+[a-z]|\s[,.]")


def clean_book(t):
    """书里那句能不能直接用：有定位标记、题号、答案串、粘连数字的不用（返回 None）"""
    t = re.sub(r"\s+", " ", t).strip()
    if BAD_BOOK.search(t):
        return None
    if not re.search(r"[.?!][\"')]*$", t):
        return None
    # 只能有字母、数字、撇号和正常标点（书里的 ² { } 之类杂符号不能带进来）
    if not BOOK_CHARS.fullmatch(t):
        return None
    return t


BOOK_CHARS = re.compile(r"[A-Za-z0-9 '’‘.,;:?!\-–—\"“”%$£&/]+")


def apostrophes(t):
    return len(re.findall(r"[A-Za-z]['’][A-Za-z]", t))


# ---------- 命令 ----------

def content_lines(seg):
    return [l for l in seg.get("lines", []) if not l.get("kind") and (l.get("text") or "").strip()]


def catalog_ids():
    return [x["id"] for x in jload(PAPERS / "index.json") if x["id"].startswith("cet")]


def shared_from(paper):
    sh = next((x for x in paper.get("shared") or [] if x["section"] == "listening"), None)
    return sh["from"] if sh else None


def garble(seg):
    """原文乱码程度：识别错字、粘连长词（≥12 个字母、词典里没有）的比例；缩写（doesn't）和普通专名不算"""
    import align_transcripts as A

    toks = [t for l in content_lines(seg) for t in re.findall(r"[A-Za-z]+(?:['’][A-Za-z]+)?", l["text"])]
    if len(toks) < 30:
        return 0.0
    bad = [t for t in toks if "'" not in t and "’" not in t and len(t) > 2 and not A.is_word(t) and not (t[0].isupper() and t[1:].islower() and len(t) < 12)]
    glued = [t for t in bad if len(t) >= 12]
    return (len(bad) + 2 * len(glued)) / len(toks)


GARBLE_MAX = 0.03


EXTRA_TODO = ASR / "extra_todo.txt"  # 人工指定要重写的段：每行 "id 段 原因"


def todo_list():
    """[(id, 段, 原因)]：只列自己有录音的套（第 3 套接来的听力随被借那套走）"""
    out = []
    extra = {}
    if EXTRA_TODO.exists():
        for line in EXTRA_TODO.read_text("utf-8").splitlines():
            parts = line.split(None, 2)
            if len(parts) >= 2 and not line.startswith("#"):
                extra[(parts[0], parts[1])] = parts[2] if len(parts) > 2 else "人工指定"
    for pid in catalog_ids():
        p = jload(PAPERS / f"{pid}.json")
        if shared_from(p) or not p.get("audio"):
            continue
        segs = p["audio"]["segments"]
        if len(segs) == 1 and segs[0]["id"] == "all":
            out.append((pid, "all", "整段没切题组"))
            continue
        used = {g.get("audioSegment") for s in p["sections"] if s["kind"] == "listening" for g in s["groups"]}
        for s in segs:
            if s["id"] not in used or s.get("source") == "asr":
                continue
            c = content_lines(s)
            if not c:
                out.append((pid, s["id"], "没有原文"))
            elif len(c) <= 2:
                out.append((pid, s["id"], f"原文只有 {len(c)} 句"))
            else:
                gb = garble(s)
                long_ = max(l["end"] - l["start"] for l in s["lines"] if (l.get("text") or "").strip())
                if gb > GARBLE_MAX or long_ > 40:
                    out.append((pid, s["id"], f"疑似乱码（乱码度 {gb:.1%}，最长一句 {long_:.0f} 秒）"))
                elif (pid, s["id"]) in extra:
                    out.append((pid, s["id"], f"疑似乱码（人工指定：{extra[(pid, s['id'])]}）"))
    return out


def fill(pid, sids=None, log=print, write=True):
    p = jload(PAPERS / f"{pid}.json")
    if shared_from(p):
        raise SystemExit(f"{pid} 的听力接自 {shared_from(p)}，补那一套后跑 listen_locate.py sync")
    if not sids:
        sids = [s for q, s, why in todo_list() if q == pid and s != "all"]
    book = Book(answers_pdf(pid))
    rep = []
    old_lines = {}
    for sid in sids:
        seg = next(s for s in p["audio"]["segments"] if s["id"] == sid)
        r = transcribe(p, sid, log)
        lines, nb = segment_lines(r["words"], float(seg["start"]), float(seg["end"]), book)
        strip_marks(lines)
        nc = sum(1 for l in lines if not l.get("kind"))
        if nc < 3:
            log(f"  {pid} {sid}：识别出的原文只有 {nc} 句，不写")
            continue
        old = len(content_lines(seg))
        inherit_speakers(orig_lines(pid, seg), lines)
        old_lines[sid] = seg["lines"]
        seg["lines"] = lines
        seg["source"] = "asr"
        if nb:
            seg["bookLines"] = nb
        else:
            seg.pop("bookLines", None)
        rep.append((sid, old, nc, nb))
        log(f"  {pid} {sid}：原文 {old} → {nc} 句（其中 {nb} 句取自解析书），共 {len(lines)} 行")
    if write and rep:
        save_paper(p)
        relink(p, {sid: old_lines[sid] for sid, *_ in rep}, log)
    return rep


def overlap(a, b):
    return max(0.0, min(a["end"], b["end"]) - max(a["start"], b["start"]))


def inherit_speakers_by_time(old, new):
    """（旧做法，只留着做对照）新句按时间重叠最多的旧原文句继承说话人。老原文的时间是按时长摊的，不可靠"""
    olds = [l for l in old if not l.get("kind") and l.get("speaker")]
    out = {}
    if not olds:
        return out
    for i, l in enumerate(new):
        if l.get("kind"):
            continue
        best = max(olds, key=lambda o: overlap(o, l))
        if overlap(best, l) > 0.3 * max(0.1, l["end"] - l["start"]):
            out[i] = best["speaker"]
    return out


TWO_MARK = re.compile(r"(?:^|(?<=[\s.?!\"']))(?:M|W|VV|Man|Woman)\s*[:：;]")


def speakers_by_text(old, new):
    """新句按文字对齐继承旧原文句的说话人：新旧两份按词序列对齐（difflib），新句取它对上最多词的那条旧句的 M/W；
    对不上的沿用上一句。旧段说话人不全（原文句里有说话人的不到 80%）就整段不继承；旧句一行夹两个人的不当依据。
    返回 {新句下标: M/W}"""
    oc = [l for l in old if not l.get("kind") and (l.get("text") or "").strip()]
    if not oc or sum(1 for l in oc if l.get("speaker")) / len(oc) < 0.8:
        return {}
    ow, oi = [], []
    for k, l in enumerate(oc):
        two = len(TWO_MARK.findall(l["text"])) >= 2 or any(m.start() > 0 for m in TWO_MARK.finditer(l["text"]))
        for w in mwords(l["text"]):
            ow.append(w[:7])
            oi.append(None if two or not l.get("speaker") else k)
    nw, ni = [], []
    for i, l in enumerate(new):
        if l.get("kind"):
            continue
        for w in mwords(l.get("text") or ""):
            nw.append(w[:7])
            ni.append(i)
    votes = defaultdict(Counter)
    sm = difflib.SequenceMatcher(None, nw, ow, autojunk=False)
    for blk in sm.get_matching_blocks():
        for d in range(blk.size):
            k = oi[blk.b + d]
            if k is not None:
                votes[ni[blk.a + d]][k] += 1
    out, prev = {}, None
    for i, l in enumerate(new):
        if l.get("kind"):
            continue
        v = votes.get(i)
        if v:
            k, n = v.most_common(1)[0]
            # 一般要对上 2 个词才算；"Right." "Yes." 这种一两个词的短句（多在换人处）对上 1 个就算
            if n >= 2 or (n >= 1 and len(mwords(l.get("text") or "")) <= 2):
                prev = oc[k]["speaker"]
        if prev:
            out[i] = prev
    return out


ORIG = ASR / "orig"  # 第一次用识别结果重写一段时，原来的行存在这里（继承说话人用）


def orig_lines(pid, seg):
    f = ORIG / f"{pid}.{seg['id']}.json"
    if f.exists():
        return jload(f)
    if seg.get("source") != "asr":
        ORIG.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(seg["lines"], ensure_ascii=False), "utf-8")
        return seg["lines"]
    return []


def inherit_speakers(old, new):
    """新句按文字对齐继承说话人（见 speakers_by_text）"""
    for i, who in speakers_by_text(old, new).items():
        new[i]["speaker"] = who


def quote_from(line_text, old_quote, max_words=25):
    """新原文句里和旧引文最像的连续 ≤25 词（原样）"""
    toks = line_text.split()
    if len(toks) <= max_words:
        return line_text.strip()
    q = set(w[:7] for w in mwords(old_quote))
    best, bi = -1, 0
    for i in range(0, len(toks) - max_words + 1):
        sc = sum(1 for t in toks[i:i + max_words] for w in mwords(t) if w[:7] in q)
        if sc > best:
            best, bi = sc, i
    return " ".join(toks[bi:bi + max_words])


def relink(paper, olds, log=print):
    """这几段的行重写过了（olds = {段: 旧 lines}）：段里各题的 locate.line 先按 quote 重新匹配；
    引文是旧原文里的乱码、对不上新原文的，按旧行号那句的时间找新原文里重叠最多的一句，引文换成新句里的原文；
    都不行就删掉旧的 line，免得指错句"""
    import listen_locate as LL

    ep = LL.EXPLAIN / f"{paper['id']}.json"
    if not ep.exists():
        return
    raw = ep.read_bytes()
    layer = json.loads(raw.decode("utf-8"))
    n = gone = retimed = 0
    for g, q, seg in LL.listening_items(paper):
        if not seg or seg["id"] not in olds:
            continue
        loc = ((layer["questions"].get(q["id"]) or {}).get("fields") or {}).get("locate")
        if not isinstance(loc, dict):
            continue
        idx = None
        if loc.get("quote"):
            idx, _ = LL.match_quote(loc["quote"], seg["lines"])
        ol = (loc.get("line") or {}).get("index")
        old = olds.get(seg["id"]) or []
        if idx is None and ol is not None and ol < len(old):
            o = old[ol]
            cands = [(overlap(o, l), i) for i, l in enumerate(seg["lines"]) if LL.is_content(l)]
            ov, i = max(cands) if cands else (0, None)
            if i is not None and ov > 0.5 * min(o["end"] - o["start"], seg["lines"][i]["end"] - seg["lines"][i]["start"]):
                idx = i
                loc["quote"] = quote_from(seg["lines"][i]["text"], loc.get("quote") or "")
                retimed += 1
        if idx is not None:
            loc["line"] = {"segment": seg["id"], "index": idx}
            n += 1
        elif "line" in loc:
            del loc["line"]
            gone += 1
    LL.save_layer(ep, layer, raw)
    log(f"  解析层 {paper['id']}：重新定位 {n} 题（其中 {retimed} 题按时间找回、引文换成新原文）" + (f"，{gone} 题对不上、去掉了旧行号" if gone else ""))


def split_all(pid, log=print, write=True):
    """整份录音（只有一个 all 段）按题组切开：每组从上一组最后一题读完后的第一句开始，到本组最后一题读完为止"""
    p = jload(PAPERS / f"{pid}.json")
    a = p["audio"]
    groups = [g for s in p["sections"] if s["kind"] == "listening" for g in s["groups"]]
    ours = [s["id"] for s in a["segments"]] == [g["id"] for g in groups] and all(s.get("source") == "asr" for s in a["segments"])
    if not (len(a["segments"]) == 1 and a["segments"][0]["id"] == "all") and not (ours and asr_file(pid, "all").exists()):
        raise SystemExit(f"{pid} 已经切过题组")
    r = transcribe(p, "all", log)
    book = Book(answers_pdf(pid))
    lines, nb = segment_lines(r["words"], 0.0, float(a["duration"]), book)
    qline = {}
    for i, l in enumerate(lines):
        if l.get("kind") == "question":
            n = int(re.match(r"Question (\d+)", l["text"]).group(1))
            qline.setdefault(n, i)
    segs, prev_end = [], -1
    for gi, g in enumerate(groups):
        last = g["questions"][-1]["number"]
        if last not in qline:
            raise SystemExit(f"{pid}：识别结果里没找到 Question {last}（{g['id']} 的最后一题），切不了，要人工看")
        hi = qline[last]
        lo = prev_end + 1
        part = lines[lo:hi + 1]
        if not part:
            raise SystemExit(f"{pid}：{g['id']} 是空的")
        segs.append({"id": g["id"], "label": g.get("title") or g["id"], "start": part[0]["start"], "end": part[-1]["end"], "lines": part, "source": "asr"})
        prev_end = hi
    rest = lines[prev_end + 1:]
    for s in segs:
        nbk = strip_marks(s["lines"])
        if nbk:
            s["bookLines"] = nbk
    strip_marks(rest)
    for g, s in zip(groups, segs):
        nc = sum(1 for l in s["lines"] if not l.get("kind"))
        qs = sorted(int(re.match(r"Question (\d+)", l["text"]).group(1)) for l in s["lines"] if l.get("kind") == "question")
        log(f"  {s['id']:6s} {s['start']:7.1f}–{s['end']:7.1f}  原文 {nc} 句  读题 {qs}  题组 {[q['number'] for q in g['questions']]}")
    if rest:
        log(f"  最后一组之后还有 {len(rest)} 行（不收）：{' / '.join(l['text'][:40] for l in rest[:3])}")
    log(f"  全卷 {nb} 句原文取自解析书")
    if write:
        a["segments"] = segs
        for g in groups:
            g["audioSegment"] = g["id"]
        save_paper(p)
    return segs


OPTIONISH = re.compile(r"(?:^|\s)[A-D]\)\s|[一-鿿]")


def review(ids=None, log=print):
    """识别补出的段逐段核对：读题号和题组对得上、有 cue、原文里没有选项样式（A) …）和汉字、首末句。返回有问题的段"""
    probs = []
    for pid in ids or catalog_ids():
        p = jload(PAPERS / f"{pid}.json")
        if shared_from(p) or not p.get("audio"):
            continue
        segs = {s["id"]: s for s in p["audio"]["segments"]}
        for sec in p["sections"]:
            if sec["kind"] != "listening":
                continue
            for g in sec["groups"]:
                s = segs.get(g.get("audioSegment"))
                if not s or s.get("source") != "asr":
                    continue
                want = [q["number"] for q in g["questions"]]
                got = [int(m.group(1)) for l in s["lines"] if l.get("kind") == "question" for m in [re.match(r"Question (\d+)", l["text"])] if m]
                cue = [l for l in s["lines"] if l.get("kind") == "cue"]
                c = content_lines(s)
                bad = [l["text"] for l in c if OPTIONISH.search(l["text"])]
                issues = []
                if got != want:
                    issues.append(f"读题 {got} ≠ 题组 {want}")
                if len(cue) != 1:
                    issues.append(f"cue {len(cue)} 行")
                if bad:
                    issues.append(f"原文里像选项/有汉字 {len(bad)} 句：{bad[0][:50]}")
                if len(c) < 5:
                    issues.append(f"原文只有 {len(c)} 句")
                log(f"{pid} {s['id']:5s} {len(c):3d} 句（书 {s.get('bookLines', 0):2d}）{'  ⚠ ' + '；'.join(issues) if issues else ''}")
                log(f"     首：{c[0]['text'][:90] if c else ''}")
                log(f"     末：{c[-1]['text'][:90] if c else ''}")
                if issues:
                    probs.append((pid, s["id"], issues))
    log(f"有问题的段：{len(probs)}")
    return probs


def show(pid, sid):
    p = jload(PAPERS / f"{pid}.json")
    seg = next(s for s in p["audio"]["segments"] if s["id"] == sid)
    r = transcribe(p, sid)
    lines, nb = segment_lines(r["words"], float(seg["start"]), float(seg["end"]), Book(answers_pdf(pid)))
    for l in lines:
        print(f"{l['start']:7.1f} {l['end']:7.1f} {l.get('kind') or '':10s} {l['text']}")
    print(f"（{nb} 句取自解析书）")


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    os.environ.setdefault("OMP_NUM_THREADS", str(THREADS))
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["transcribe", "show", "fill", "split", "todo", "review"])
    ap.add_argument("id", nargs="?")
    ap.add_argument("segs", nargs="*")
    ap.add_argument("--dry", action="store_true", help="fill/split 只打印不写")
    a = ap.parse_args()
    if a.cmd == "todo":
        for pid, sid, why in todo_list():
            print(f"{pid:16s} {sid:6s} {why}")
        return
    if a.cmd == "review":
        review([a.id] + a.segs if a.id else None)
        return
    if a.cmd == "transcribe":
        p = jload(PAPERS / f"{a.id}.json")
        for sid in a.segs or [s for q, s, w in todo_list() if q == a.id]:
            transcribe(p, sid)
    elif a.cmd == "show":
        show(a.id, a.segs[0])
    elif a.cmd == "fill":
        fill(a.id, a.segs, write=not a.dry)
    elif a.cmd == "split":
        split_all(a.id, write=not a.dry)


if __name__ == "__main__":
    main()
