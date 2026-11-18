"""把每题的答案解析整理成结构化字段 `fields`（设计见 docs/设计任务-解析.md 第 2、3 节），写进解析层
public/papers/explain/<id>.json 每个条目的 fields / fieldsBy / fieldsVersion / fieldsFlag。

分工：脚本准备每题的输入（原文、选项、答案键、现有解析）、校验并写回；`fields` 的内容（思路、逐项、生词、
语法/语义、译文、要点/短语）由人（AI）写成一个"批次文件"，再由脚本校验合并。

流程（每套卷子）：
  1. prep   生成输入：python -I scripts/structure_explanations.py prep cet4-2025-12-1 [--part listening]
            原文取自 words.json 同一份 PDF 文字层，按阅读顺序拼好，题号、选项字母、答案键、现有解析一并列出
  2. 写批次文件 <work>/batches/<id>.<part>.json：{"q26": {...fields...}, ...}（见下面"批次写法"）
  3. merge  校验并合并：python -I scripts/structure_explanations.py merge cet4-2025-12-1
            通过的写进解析层；不通过的列出原因（不写），改好批次文件再 merge。
            已有 fields 的题默认跳过（--force 覆盖）；第二次仍不通过的可以加 --lenient 先写入并标 fieldsFlag
  4. status 覆盖率表：python -I scripts/structure_explanations.py status

校验：
  - answer 必须等于答案键
  - locate.quote（≤ 25 词）必须在原文里连续出现：阅读类在 words.json 里按词匹配（每词比前 7 个字母、允许约 15% 不一致、
    容忍同一行内词序被打乱），匹配上就补 page 和 words=[首, 末]（该页 w[] 里的序号，含）；听力题的 quote 在这一段逐字稿里
    匹配，不写 line（逐字稿行号由 align_transcripts.py --relink-explain 按 quote 补）
  - options 的键 ⊆ 该题选项字母 − 答案；四选一类要写全三个错误项，选词填空、段落匹配、段落排序（选项 7–15 个）只写最有
    迷惑性的几个
  - vocab 3–5 个，词必须出现在原文里
  - 长度：reasoning ≤ 120 字，options 每项 ≤ 30 字……见 LIMITS
  - 条目没有 text（原来没有解析）时，用 fields 拼一段旧格式的 text 做回退，by 记为 ai

批次写法（每题一个对象，键名同 schema，下面几处可以简写）：
  "locate": {"where": "第二段第三句", "quote": "…"}  或  ["第二段第三句", "…"]
  "vocab": [["expectation", "期望"], …]    "phrases": [["…", "…"]]    "mapping": [["题干词", "原文表达"]]
  选择题：answer、locate、reasoning（选词填空/完形改写 grammar + meaning）、options、vocab、translation
          段落匹配另加 mapping，options 可省；
  翻译、写作：points（3 条要点）、phrases（亮点表达），没有 answer

用法：python -I scripts/structure_explanations.py {prep,merge,status} [试卷 id ...] [选项]
"""
import argparse
import glob
import io
import json
import os
import re
import sys
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parent.parent
PAPERS = ROOT / "public" / "papers"
EXPLAIN = PAPERS / "explain"
WORK_DEFAULT = ROOT / "data" / "cache" / "structure"
FIELDS_VERSION = 1
EXPLAIN_MAX = 520  # prep 里每条现有解析最多显示多少字，0 = 不截

SUBJECTIVE = ("translation", "writing")
# 每类题要写的字段（"locate" 总是要；其余见 validate）
LIMITS = {
    "where": 24,
    "reasoning": 120,
    "option": 30,
    "grammar": 80,
    "meaning": 120,
    "translation": 150,
    "map_stem": 70,
    "map_text": 70,
    "vocab_zh": 14,
    "point": 120,
    "phrase_en": 70,
    "phrase_zh": 24,
    "quote_words": 25,
}

# ---------- 读文件 ----------


def jload(p):
    with io.open(p, encoding="utf-8") as f:
        return json.load(f)


def jsave(p, data):
    tmp = str(p) + ".tmp"
    with io.open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, p)


def paper_ids():
    return sorted(os.path.basename(p)[:-5] for p in glob.glob(str(PAPERS / "*.json")) if not p.endswith("index.json"))


def load_paper(pid):
    return jload(PAPERS / f"{pid}.json")


def load_words(pid):
    return jload(PAPERS / "pdf" / f"{pid}.words.json")["pages"]


def load_layer(pid):
    p = EXPLAIN / f"{pid}.json"
    return jload(p) if p.exists() else {"id": pid, "questions": {}, "groups": {}}


def iter_questions(paper):
    for sec in paper["sections"]:
        for g in sec["groups"]:
            for q in g["questions"]:
                yield sec, g, q


def kind_of(sec, q):
    return sec["kind"]


# ---------- 文字匹配 ----------

ALPHA = re.compile(r"[A-Za-z][A-Za-z'’]*(?:-[A-Za-z]+)*")


def tok_key(t):
    """词 → 比较用的键：只留字母、小写、前 7 个（容忍 OCR 把词尾识别错）"""
    return re.sub(r"[^a-z]", "", t.lower())[:7]


def text_keys(text):
    return [tok_key(m.group()) for m in ALPHA.finditer(text) if tok_key(m.group())]


def tok_eq(a, b):
    if a == b:
        return True
    if len(a) >= 5 and len(b) >= 5 and abs(len(a) - len(b)) <= 1:
        # 编辑距离 1（OCR 错字）
        if len(a) == len(b):
            return sum(x != y for x, y in zip(a, b)) <= 1
        s, l = (a, b) if len(a) < len(b) else (b, a)
        for i in range(len(l)):
            if l[:i] + l[i + 1 :] == s:
                return True
    return False


def fuzzy_find(q, p, tol=0.15):
    """在词键序列 p 里找和 q 最像的一段（词级编辑距离，允许插入、删除、替换）。
    返回 (距离, 首, 末)，找不到合格的返回 None。q 里的词要有一部分对上才算"""
    n, N = len(q), len(p)
    if n < 3 or N == 0:
        return None
    maxd = max(1, int(round(tol * n)))
    # Sellers：d[i][j] = q[:i] 对齐到以 p[j-1] 结尾的某一段的最小代价；同时记起点
    INF = 10**6
    prev = [(0, j) for j in range(N + 1)]  # i=0：任意起点，代价 0
    for i in range(1, n + 1):
        cur = [(i, 0)] + [(INF, 0)] * N
        for j in range(1, N + 1):
            sub = prev[j - 1][0] + (0 if tok_eq(q[i - 1], p[j - 1]) else 1)
            best = (sub, prev[j - 1][1])
            dele = prev[j][0] + 1  # q 里多一个词
            if dele < best[0]:
                best = (dele, prev[j][1])
            ins = cur[j - 1][0] + 1  # p 里多一个词
            if ins < best[0]:
                best = (ins, cur[j - 1][1])
            cur[j] = best
        prev = cur
    # 取代价最小的终点（末词必须真的对上）
    cand = [(prev[j][0], prev[j][1], j) for j in range(1, N + 1) if prev[j][0] <= maxd and tok_eq(q[-1], p[j - 1])]
    if not cand:
        return None
    d, s, e = min(cand, key=lambda c: (c[0], -c[2]))
    return d, s, e - 1


def unordered_find(q, p, need=0.85):
    """行内词序被打乱时（words.json 按 y/3 取整分桶排序，同一行可能被拆成两截）的退路：
    找一段长度不超过 len(q)+6 的窗口，覆盖 q 里 85% 以上的词（多重集）"""
    n, N = len(q), len(p)
    if n < 4 or N == 0:
        return None
    from collections import Counter

    qc = Counter(q)
    best = None
    for i in range(N):
        if p[i] not in qc:
            continue
        have = Counter()
        hit = 0
        for j in range(i, min(N, i + n + 6)):
            k = p[j]
            if k in qc and have[k] < qc[k]:
                have[k] += 1
                hit += 1
                if hit / n >= need and (best is None or hit > best[0] or (hit == best[0] and j - i < best[2] - best[1])):
                    best = (hit, i, j)
    if not best:
        return None
    hit, i, j = best
    # 收缩到首末都是 q 里的词
    return n - hit, i, j


def find_quote_on_pages(quote, pages, hint_pages=None, partial=True):
    """在 words.json 的 pages（0 起）里找 quote。返回 (page 1 起, [首, 末], 方式) 或 None。
    整句找不到（常见原因：句子跨页、被页脚打断）时，退而求其次找前半或后半（≥ 5 个词、≥ 40%），方式记为 partial"""
    q = text_keys(quote)
    if len(q) < 3:
        return None
    hit = _find_keys(q, pages, hint_pages)
    if hit or not partial or len(q) < 8:
        return hit
    n = len(q)
    need = max(5, int(n * 0.4 + 0.999))
    for k in range(n - 2, need - 1, -2):
        for part in (q[:k], q[n - k :]):
            hit = _find_keys(part, pages, hint_pages)
            if hit:
                return (hit[0], hit[1], "partial")
    return None


def _find_keys(q, pages, hint_pages=None):
    best = None
    for pi, pg in enumerate(pages):
        if hint_pages is not None and (pi + 1) not in hint_pages:
            continue
        p = [tok_key(w[0]) for w in pg["w"]]
        r = fuzzy_find(q, p)
        mode = "order"
        if r is None:
            r = unordered_find(q, p)
            mode = "unordered"
        if r is None:
            continue
        d, s, e = r
        rank = (d + (0.5 if mode == "unordered" else 0), pi)
        if best is None or rank < best[0]:
            best = (rank, pi + 1, [s, e], mode)
    return None if best is None else (best[1], best[2], best[3])


def find_quote_in_lines(quote, lines):
    """听力：quote 在一段逐字稿（lines[].text 拼起来）里找，找到返回 True"""
    q = text_keys(quote)
    p = []
    for ln in lines:
        p.extend(text_keys(ln.get("text") or ""))
    if len(q) < 3:
        return False
    return fuzzy_find(q, p) is not None or unordered_find(q, p) is not None


def word_in_corpus(word, corpus):
    """生词是否出现在原文里：每个词都得在原文里有（容忍词形变化：前 max(4, len-3) 个字母一致）"""
    for part in re.findall(r"[A-Za-z][A-Za-z'’-]*", word):
        w = re.sub(r"[^a-z]", "", part.lower())
        if not w:
            continue
        if w in corpus:
            continue
        if len(w) < 4:
            return False
        stem = w[: max(4, len(w) - 3)]
        if not any(c.startswith(stem) or (len(c) >= 4 and w.startswith(c[: max(4, len(c) - 3)])) for c in corpus):
            return False
    return True


def corpus_of(text):
    c = set()
    for m in ALPHA.finditer(text):
        t = m.group().lower()
        c.add(re.sub(r"[^a-z]", "", t))
        for part in t.split("-"):
            part = re.sub(r"[^a-z]", "", part)
            if part:
                c.add(part)
    return c


# ---------- 原文装配（给人读的输入） ----------


def get_words(page):
    """页面上的单词；有些 PDF 的文字层有两份，只留前一份（同 cet_ocr.get_words）"""
    words = page.get_text("words")
    if len(words) < 60:
        return words
    top, cut = 0.0, None
    for i, w in enumerate(words):
        if i >= 30 and w[1] < top - 150 and w[5] != words[i - 1][5]:
            cut = i
            break
        top = max(top, w[1])
    if cut is None:
        return words
    from collections import Counter

    letters = lambda ws: Counter(c for w in ws for c in w[4].lower() if c.isalpha())
    ca, cb = letters(words[:cut]), letters(words[cut:])
    same = sum((ca & cb).values()) / max(1, max(sum(ca.values()), sum(cb.values())))
    return words[:cut] if same > 0.85 else words


def group_rows(words):
    words = sorted(words, key=lambda w: ((w[1] + w[3]) / 2, w[0]))
    rows, cur = [], []
    for w in words:
        if cur and abs((w[1] + w[3]) / 2 - sum((c[1] + c[3]) / 2 for c in cur) / len(cur)) > 0.5 * max(w[3] - w[1], 4):
            rows.append(sorted(cur, key=lambda c: c[0]))
            cur = []
        cur.append(w)
    if cur:
        rows.append(sorted(cur, key=lambda c: c[0]))
    return rows


def region_rows(doc, p0, y0, p1, y1):
    """从 (p0, y0) 到 (p1, y1) 之间的行（页号 1 起）：[(页, 行首 x0, 行 y, 文字)]"""
    out = []
    for pno in range(p0, p1 + 1):
        if pno > len(doc):
            break
        for row in group_rows(get_words(doc[pno - 1])):
            y = (row[0][1] + row[0][3]) / 2
            if pno == p0 and y < y0:
                continue
            if pno == p1 and y >= y1:
                continue
            out.append((pno, row[0][0], y, " ".join(w[4] for w in row)))
    return out


LABEL_ROW = re.compile(r"^\(?[A-O]\)|^\d{1,2}\s*[.．]|^Questions? \d|^Passage |^Section |^Directions?")
ABBR = ("Mr.", "Mrs.", "Ms.", "Dr.", "St.", "U.S.", "e.g.", "i.e.", "etc.", "vs.", "No.", "p.m.", "a.m.", "Jr.", "Prof.")


def rows_to_paragraphs(rows, number_sentences=False, number_paras=False):
    """行 → 段：缩进、标签行（A) / 36. / Passage）另起一段"""
    if not rows:
        return []
    xs = sorted(r[1] for r in rows)
    margin = xs[len(xs) // 10]
    paras, cur, lastp = [], [], None
    for pno, x0, y, text in rows:
        # 新段：缩进或标签行，而且上一行是在句末收的（行首缩进有时是词间空隙，不能每个缩进行都断段）
        ended = bool(cur) and bool(re.search(r"[.?!:;。”\"’)\]]$", cur[-1].rstrip()))
        new = bool(cur) and ((x0 - margin > 6 and ended) or bool(LABEL_ROW.match(text)))
        if new:
            paras.append(" ".join(cur))
            cur = []
        cur.append(text)
        lastp = pno
    if cur:
        paras.append(" ".join(cur))
    out, k = [], 0
    for ptxt in paras:
        if re.match(r"^(Passage (One|Two|Three)|Text \d|Questions? \d)", ptxt):
            k = 0  # 新一篇文章，段落重新数
        elif number_paras:
            k += 1
        if number_sentences:
            ptxt = number_sents(ptxt)
        out.append(f"¶{k} {ptxt}" if number_paras and k else ptxt)
    return out


def number_sents(text):
    parts = re.split(r"(?<=[.?!])([\"”’)]*)\s+(?=[\"“(]?[A-Z0-9])", text)
    # re.split 带捕获组：[句, 引号, 句, 引号, ...]
    sents, cur = [], parts[0] if parts else ""
    for k in range(1, len(parts), 2):
        cur += parts[k]
        nxt = parts[k + 1] if k + 1 < len(parts) else ""
        if cur.split()[-1:] and cur.split()[-1] in ABBR:
            cur += " " + nxt
            continue
        sents.append(cur)
        cur = nxt
    if cur:
        sents.append(cur)
    if len(sents) <= 1:
        return text
    return " ".join(f"({i}) {s}" for i, s in enumerate(sents, 1))


def section_spans(paper):
    """每个部分在卷面上的范围：[(section, p0, y0, p1, y1)]，由 anchor 和下一部分的 anchor 决定"""
    secs = paper["sections"]
    spans = []
    for i, s in enumerate(secs):
        a = s.get("anchor")
        if not a:
            spans.append((s, None, None, None, None))
            continue
        p0, y0 = a["page"], a["box"][1] - 2
        nxt = next((t.get("anchor") for t in secs[i + 1 :] if t.get("anchor")), None)
        if nxt:
            p1, y1 = nxt["page"], nxt["box"][1] - 2
        else:
            p1, y1 = 999, 1e9
        # 个别卷子的 PDF 页序是乱的（后一部分的标题在前一部分的页之前），按题目自己所在的页把范围撑开
        qp = [q["page"] for g in s["groups"] for q in g["questions"] if q.get("page")]
        if qp and p1 != 999 and max(qp) > p1:
            p1, y1 = max(qp), 1e9
        if qp and min(qp) < p0:
            p0, y0 = min(qp), 0
        spans.append((s, p0, y0, p1, y1))
    return spans


def explanation_view(entry):
    if not entry:
        return "(无解析)"
    t = entry.get("text") or ""
    t = re.sub(r"\n+", " ", t)
    if EXPLAIN_MAX and len(t) > EXPLAIN_MAX:
        t = t[:EXPLAIN_MAX] + "…"  # 解析前半段已经有定位和结论；排除项的长篇大论不用全看（--full 不截）
    fl = entry.get("flag")
    return f"[{entry.get('by')}{' flag=' + fl if fl else ''}] {t}"


def part_of(sec):
    k = sec["kind"]
    return "subjective" if k in SUBJECTIVE else k


def build_input(pid, part=None, pending_only=True):
    paper = load_paper(pid)
    layer = load_layer(pid)
    doc = fitz.open(PAPERS / "pdf" / f"{pid}.pdf") if paper.get("pdf") else None
    fitz.TOOLS.mupdf_display_errors(False)
    out = [f"# {pid}  {paper.get('title', '')}"]
    segs = {s["id"]: s for s in (paper.get("audio") or {}).get("segments", [])}
    for sec, p0, y0, p1, y1 in section_spans(paper):
        pt = part_of(sec)
        if part and part != pt:
            continue
        qs = [(g, q) for g in sec["groups"] for q in g["questions"]]
        todo = [(g, q) for g, q in qs if not (pending_only and "fields" in layer["questions"].get(q["id"], {}))]
        if not todo:
            continue
        out.append(f"\n## {pt}  {sec['id']}  {sec.get('title', '')}  （页 {p0}–{p1 if p1 != 999 else '末'}）")
        if sec.get("directions") and pt != "subjective":
            out.append("说明：" + sec["directions"][:200])
        if pt == "subjective":
            for g, q in todo:
                ent = layer["questions"].get(q["id"], {})
                out.append(f"\n### {q['id']} {q.get('label', '')} {pt}")
                if q.get("stem"):
                    out.append("题目：" + q["stem"].replace("\n", " ⏎ "))
                ref = ent.get("reference") or q.get("reference") or ""
                out.append("参考：" + ref.replace("\n", " ⏎ "))
                if ent.get("text"):
                    out.append("现有解析：" + explanation_view(ent))
            continue
        if pt == "listening":
            for g in sec["groups"]:
                sg = segs.get(g.get("audioSegment"))
                if not sg:
                    continue
                out.append(f"\n### 听力 {g['id']} {sg.get('label', '')} 题 {[q['number'] for q in g['questions']]}")
                for i, ln in enumerate(sg["lines"]):
                    t = ln.get("text")
                    if t:
                        out.append(f"  {('[' + ln['speaker'] + '] ') if ln.get('speaker') else ''}{t}")
            if doc is not None:
                out.append("\n### 卷面选项（听力题只印选项）")
                rows = region_rows(doc, p0, y0, p1, y1)
                out.extend(rows_to_paragraphs(rows))
        elif pt in ("reading", "banked", "matching") and doc is not None and p0:
            out.append("\n### 原文（PDF 文字层；(n) 是句序，¶ 之间是段）")
            rows = region_rows(doc, p0, y0, p1, y1)
            paras = rows_to_paragraphs(rows, number_sentences=pt in ("reading", "matching"), number_paras=pt == "reading")
            out.extend(paras)
        else:  # 考研：原文在 JSON 里
            for g in sec["groups"]:
                if not g.get("passage"):
                    continue
                out.append(f"\n### {g['id']} {g.get('title', '')}")
                for i, ptxt in enumerate(g["passage"].get("paragraphs", []), 1):
                    out.append(f"¶{i} " + number_sents(ptxt))
        out.append(f"\n### 题目与现有解析（{pt}）")
        for g, q in todo:
            ent = layer["questions"].get(q["id"], {})
            opts = q.get("options") or []
            letters = "".join(o["key"] for o in opts)
            line = f"#{q['id']} 第{q['number']}题 键={q.get('answer')} 选项={letters}"
            if q.get("stem"):
                line += f"\n  题干：{q['stem']}"
            texts = [f"{o['key']}) {o['text']}" for o in opts if o.get("text")]
            if texts:
                line += "\n  " + " | ".join(texts)
            line += "\n  " + explanation_view(ent)
            out.append(line)
    return "\n".join(out) + "\n"


# ---------- 校验 ----------


def to_pairs(v, k1, k2):
    out = []
    for it in v or []:
        if isinstance(it, (list, tuple)) and len(it) >= 2:
            out.append({k1: str(it[0]).strip(), k2: str(it[1]).strip()})
        elif isinstance(it, dict):
            out.append({k1: str(it.get(k1, "")).strip(), k2: str(it.get(k2, "")).strip()})
    return out


def pdf_corpus(pages, p0, p1):
    texts = []
    for pi in range(max(1, p0) - 1, min(len(pages), p1)):
        texts.append(" ".join(w[0] for w in pages[pi]["w"]))
    return corpus_of(" ".join(texts))


class Ctx:
    """一套卷子校验要用的东西，只加载一次"""

    def __init__(self, pid):
        self.pid = pid
        self.paper = load_paper(pid)
        self.pages = load_words(pid)
        self.layer = load_layer(pid)
        self.segs = {s["id"]: s for s in (self.paper.get("audio") or {}).get("segments", [])}
        self.spans = {s["id"]: (p0, p1) for s, p0, y0, p1, y1 in section_spans(self.paper)}
        self._sec_corpus = {}

    def section_corpus(self, sec):
        if sec["id"] not in self._sec_corpus:
            p0, p1 = self.spans[sec["id"]]
            c = pdf_corpus(self.pages, p0 or 1, p1 or 999) if p0 else set()
            # 考研：原文在 JSON 里
            for g in sec["groups"]:
                if g.get("passage"):
                    c |= corpus_of(" ".join(g["passage"].get("paragraphs", [])))
                for q in g["questions"]:
                    c |= corpus_of((q.get("stem") or "") + " " + " ".join(o.get("text", "") for o in q.get("options", [])))
            self._sec_corpus[sec["id"]] = c
        return self._sec_corpus[sec["id"]]


def clip(s, n):
    return len(s) <= n


def validate(ctx, sec, g, q, raw):
    """返回 (fields 或 None, [错误], [提示])。fields 是整理好的 dict"""
    errs, notes = [], []
    kind = sec["kind"]
    f = {}
    letters = [o["key"] for o in q.get("options", [])]
    key = q.get("answer")

    def req_text(name, limit, label=None):
        v = raw.get(name)
        v = v.strip() if isinstance(v, str) else ""
        if not v:
            errs.append(f"缺 {name}")
            return ""
        if len(v) > limit:
            errs.append(f"{label or name} 超长（{len(v)} > {limit}）")
        return v

    if kind in SUBJECTIVE:
        pts = [str(x).strip() for x in (raw.get("points") or []) if str(x).strip()]
        if not 2 <= len(pts) <= 4:
            errs.append(f"points 要 2–4 条（现有 {len(pts)}）")
        for x in pts:
            if len(x) > LIMITS["point"]:
                errs.append(f"points 里一条超长（{len(x)} > {LIMITS['point']}）：{x[:20]}…")
        phr = to_pairs(raw.get("phrases"), "en", "zh")
        if not 3 <= len(phr) <= 6:
            errs.append(f"phrases 要 3–6 条（现有 {len(phr)}）")
        for p in phr:
            if not p["en"] or not p["zh"]:
                errs.append("phrases 里有空项")
            elif len(p["en"]) > LIMITS["phrase_en"] or len(p["zh"]) > LIMITS["phrase_zh"]:
                errs.append(f"phrases 里一条超长：{p['en'][:20]}")
        f = {"points": pts, "phrases": phr}
        return (None if errs else f), errs, notes

    # ---- 选择题 ----
    ans = raw.get("answer")
    if ans != key:
        errs.append(f"answer {ans!r} ≠ 键 {key!r}")
    f["answer"] = key

    # locate
    loc = raw.get("locate")
    if isinstance(loc, (list, tuple)) and len(loc) >= 2:
        loc = {"where": loc[0], "quote": loc[1]}
    if not isinstance(loc, dict):
        errs.append("缺 locate")
        loc = {}
    where = (loc.get("where") or "").strip()
    quote = (loc.get("quote") or "").strip()
    if not where:
        errs.append("locate.where 为空")
    elif len(where) > LIMITS["where"]:
        errs.append(f"locate.where 超长（{len(where)} > {LIMITS['where']}）")
    if not quote:
        errs.append("locate.quote 为空")
    nwords = len(ALPHA.findall(quote))
    if nwords > LIMITS["quote_words"]:
        errs.append(f"quote 太长（{nwords} 词 > {LIMITS['quote_words']}）")
    L = {"where": where, "quote": quote}
    if kind == "listening":
        sg = ctx.segs.get(g.get("audioSegment"))
        if not sg:
            notes.append("没有逐字稿分段，quote 未核对")
        elif quote and not find_quote_in_lines(quote, sg["lines"]):
            errs.append("quote 在这一段逐字稿里找不到（要原样抄一句）")
        # 逐字稿行号由 align_transcripts.py --relink-explain 按 quote 补；已经有的 line 保留（见 merge）
    elif quote:
        p0, p1 = ctx.spans.get(sec["id"], (None, None))
        hint = None
        if p0:
            hint = set(range(p0, min(p1, len(ctx.pages)) + 1))
        # 考研卷：部分没有 anchor 时（本卷有），不限页
        hit = find_quote_on_pages(quote, ctx.pages, hint) or (find_quote_on_pages(quote, ctx.pages) if hint else None)
        if hit:
            L["page"], L["words"] = hit[0], hit[1]
            if hit[2] == "unordered":
                notes.append("quote 按乱序窗口匹配")
            elif hit[2] == "partial":
                notes.append("quote 跨页或被打断，只标出了其中一段")
        else:
            errs.append("quote 在卷面文字里匹配不到（原样抄原文里连续的一句；跨页的截一半）")
    f["locate"] = L

    # reasoning / grammar+meaning
    if kind in ("banked", "cloze"):
        f["grammar"] = req_text("grammar", LIMITS["grammar"])
        f["meaning"] = req_text("meaning", LIMITS["meaning"])
    else:
        f["reasoning"] = req_text("reasoning", LIMITS["reasoning"])

    # options：错误项逐个说明
    opts = raw.get("options") or {}
    if not isinstance(opts, dict):
        errs.append("options 要写成 {字母: 说明}")
        opts = {}
    wrong = [l for l in letters if l != key]
    bad = [k for k in opts if k not in wrong]
    if bad:
        errs.append(f"options 的键 {bad} 不在『选项 − 答案』里")
    if len(letters) <= 5:
        miss = [k for k in wrong if k not in opts]
        if miss:
            errs.append(f"options 缺 {miss}（四选一要写全三个错误项）")
    elif kind != "matching" and not opts:
        errs.append("options 至少写一个最有迷惑性的错误项")
    for k, v in opts.items():
        if not isinstance(v, str) or not v.strip():
            errs.append(f"options.{k} 为空")
        elif len(v) > LIMITS["option"]:
            errs.append(f"options.{k} 超长（{len(v)} > {LIMITS['option']}）")
    f["options"] = {k: opts[k].strip() for k in sorted(opts) if k in wrong and isinstance(opts[k], str)}
    if kind == "matching" and not f["options"]:
        del f["options"]

    if kind == "matching":
        mp = to_pairs(raw.get("mapping"), "stem", "text")
        if not 1 <= len(mp) <= 4:
            errs.append(f"mapping 要 1–4 对（现有 {len(mp)}）")
        for m in mp:
            if not m["stem"] or not m["text"]:
                errs.append("mapping 里有空项")
            elif len(m["stem"]) > LIMITS["map_stem"] or len(m["text"]) > LIMITS["map_text"]:
                errs.append(f"mapping 里一项超长：{m['stem'][:20]}")
        f["mapping"] = mp

    # vocab
    voc = to_pairs(raw.get("vocab"), "w", "zh")
    if not 3 <= len(voc) <= 5:
        errs.append(f"vocab 要 3–5 个（现有 {len(voc)}）")
    corpus = ctx.section_corpus(sec)
    if kind == "listening":
        sg = ctx.segs.get(g.get("audioSegment"))
        if sg:
            corpus = corpus | corpus_of(" ".join(ln.get("text") or "" for ln in sg["lines"]))
    for v in voc:
        if not v["w"] or not v["zh"]:
            errs.append("vocab 里有空项")
        elif len(v["zh"]) > LIMITS["vocab_zh"]:
            errs.append(f"vocab.{v['w']} 释义超长（{len(v['zh'])} > {LIMITS['vocab_zh']}）")
        elif not word_in_corpus(v["w"], corpus):
            errs.append(f"vocab 里的 {v['w']!r} 在原文里没有")
    f["vocab"] = voc

    f["translation"] = req_text("translation", LIMITS["translation"])
    # 输出顺序固定
    order = ["answer", "locate", "reasoning", "grammar", "meaning", "options", "mapping", "vocab", "translation"]
    f = {k: f[k] for k in order if k in f}
    return (None if errs else f), errs, notes


def legacy_text(kind, f):
    """没有旧解析的题：用 fields 拼一段旧格式的 text 做回退"""
    L = f.get("locate", {})
    lines = []
    if L.get("where") or L.get("quote"):
        lines.append(f"【定位】{L.get('where', '')} “{L.get('quote', '')}”".strip())
    if f.get("grammar") or f.get("meaning"):
        lines.append(f"【语法判断】{f.get('grammar', '')}")
        lines.append(f"【语义判断】{f.get('meaning', '')}")
    elif f.get("reasoning"):
        lines.append(f"【详解】{f['reasoning']}")
    if f.get("options"):
        lines.append("【排除】" + "；".join(f"{k} {v}" for k, v in f["options"].items()))
    return "\n".join(lines)


def batch_files(work, pid):
    return sorted(glob.glob(str(Path(work) / "batches" / f"{pid}.*.json")) + glob.glob(str(Path(work) / "batches" / f"{pid}.json")))


def merge_paper(pid, work, force=False, lenient=False, only=None, quiet=False):
    """校验并合并这一套的批次文件。返回统计"""
    ctx = Ctx(pid)
    files = batch_files(work, pid)
    raw_all = {}
    for fp in files:
        try:
            for k, v in jload(fp).items():
                raw_all[k] = v
        except Exception as e:  # noqa: BLE001
            print(f"  {os.path.basename(fp)}: JSON 读不进来：{e}")
    st = {"files": len(files), "batch": len(raw_all), "written": 0, "skipped": 0, "failed": 0, "flagged": 0, "unknown": 0, "notes": 0}
    if not raw_all:
        return st
    layer = load_layer(pid)  # 写之前重新读一遍，别人（另一个会话）可能刚改过
    qs = {q["id"]: (sec, g, q) for sec, g, q in iter_questions(ctx.paper)}
    changed = False
    for qid, raw in raw_all.items():
        if only and qid not in only:
            continue
        if qid not in qs:
            st["unknown"] += 1
            print(f"  {qid}: 试卷里没有这道题")
            continue
        sec, g, q = qs[qid]
        ent = layer["questions"].get(qid)
        if ent and "fields" in ent and not force:
            st["skipped"] += 1
            continue
        f, errs, notes = validate(ctx, sec, g, q, raw)
        st["notes"] += len(notes)
        flag = None
        if f is None and lenient:
            # 只有"卷面上匹配不到 quote"这类可以放行；其余错误还得改
            hard = [e for e in errs if not e.startswith("quote 在")]
            if not hard:
                f, flag = lenient_build(ctx, sec, g, q, raw), "quote"
        if f is None:
            st["failed"] += 1
            print(f"  ✗ {qid}（第{q['number']}题）: " + "；".join(errs))
            continue
        old_line = None
        if ent and force:
            old = (ent.get("fields") or {}).get("locate") or {}
            if old.get("line") and old.get("quote") == f["locate"]["quote"]:
                old_line = old["line"]
        if old_line:
            f["locate"]["line"] = old_line
        if ent is None:
            ent = layer["questions"][qid] = {}
        if not ent.get("text") and sec["kind"] not in SUBJECTIVE:
            ent["text"] = legacy_text(sec["kind"], f)
            ent["by"] = "ai"
        ent["fields"] = f
        ent["fieldsBy"] = "ai"
        ent["fieldsVersion"] = FIELDS_VERSION
        if flag:
            ent["fieldsFlag"] = flag
            st["flagged"] += 1
        else:
            ent.pop("fieldsFlag", None)
        changed = True
        st["written"] += 1
        if notes and not quiet:
            print(f"  · {qid}: " + "；".join(notes))
    if changed:
        jsave(EXPLAIN / f"{pid}.json", layer)
    return st


def lenient_build(ctx, sec, g, q, raw):
    """quote 在卷面匹配不到，但其余都过了：写入但不带 page/words"""
    # 直接重跑 validate，把 quote 校验的错误之外的结果拼出来
    f, errs, _ = validate(ctx, sec, g, q, raw)
    if f is not None:
        return f
    # validate 没返回 fields：手工拼（其余项已确认没问题）
    loc = raw.get("locate")
    if isinstance(loc, (list, tuple)):
        loc = {"where": loc[0], "quote": loc[1]}
    kind = sec["kind"]
    out = {"answer": q.get("answer"), "locate": {"where": loc["where"].strip(), "quote": loc["quote"].strip()}}
    if kind in ("banked", "cloze"):
        out["grammar"], out["meaning"] = raw["grammar"].strip(), raw["meaning"].strip()
    else:
        out["reasoning"] = raw["reasoning"].strip()
    letters = [o["key"] for o in q.get("options", [])]
    opts = {k: v.strip() for k, v in (raw.get("options") or {}).items() if k in letters}
    if opts:
        out["options"] = dict(sorted(opts.items()))
    if kind == "matching":
        out["mapping"] = to_pairs(raw.get("mapping"), "stem", "text")
    out["vocab"] = to_pairs(raw.get("vocab"), "w", "zh")
    out["translation"] = raw["translation"].strip()
    return out


# ---------- 覆盖率 ----------


def paper_stats(pid):
    paper = load_paper(pid)
    layer = load_layer(pid)
    st = {"mcq": 0, "mcq_f": 0, "subj": 0, "subj_f": 0, "flag": 0, "read": 0, "read_w": 0, "listen": 0, "listen_l": 0, "listen_q": 0, "answer_bad": 0}
    for sec, g, q in iter_questions(paper):
        ent = layer["questions"].get(q["id"], {})
        f = ent.get("fields")
        subj = sec["kind"] in SUBJECTIVE
        if subj:
            st["subj"] += 1
            st["subj_f"] += bool(f)
        else:
            st["mcq"] += 1
            st["mcq_f"] += bool(f)
        if f:
            st["flag"] += bool(ent.get("fieldsFlag"))
            if not subj and f.get("answer") != q.get("answer"):
                st["answer_bad"] += 1
            loc = f.get("locate") or {}
            if sec["kind"] == "listening":
                st["listen"] += 1
                st["listen_q"] += bool(loc.get("quote"))
                st["listen_l"] += bool(loc.get("line"))
            elif not subj:
                st["read"] += 1
                st["read_w"] += bool(loc.get("words"))
    return st


def print_status(ids):
    tot = {}
    print(f"{'试卷':20} {'选择题':>10} {'主观题':>8} {'待审':>4} {'卷面标出':>10} {'听力quote':>10} {'听力line':>9}")
    for pid in ids:
        st = paper_stats(pid)
        for k, v in st.items():
            tot[k] = tot.get(k, 0) + v
        if not st["mcq"] and not st["subj"]:
            continue
        print(
            f"{pid:20} {st['mcq_f']:>4}/{st['mcq']:<4}  {st['subj_f']:>2}/{st['subj']:<2}  {st['flag']:>4} "
            f"{st['read_w']:>4}/{st['read']:<4}  {st['listen_q']:>4}/{st['listen']:<4}  {st['listen_l']:>4}/{st['listen']:<4}"
            + (f"  答案不符 {st['answer_bad']}" if st["answer_bad"] else "")
        )
    t = tot
    print(
        f"{'合计':20} {t['mcq_f']:>4}/{t['mcq']:<4}  {t['subj_f']:>2}/{t['subj']:<2}  {t['flag']:>4} "
        f"{t['read_w']:>4}/{t['read']:<4}  {t['listen_q']:>4}/{t['listen']:<4}  {t['listen_l']:>4}/{t['listen']:<4}"
    )
    if t["read"]:
        print(f"阅读类 quote 匹配到卷面 {t['read_w']}/{t['read']} = {t['read_w'] / t['read']:.0%}")
    if t["listen"]:
        print(f"听力 quote {t['listen_q']}/{t['listen']}，已补逐字稿行号 {t['listen_l']}/{t['listen']}")


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="解析结构化字段：准备输入、校验合并、覆盖率")
    ap.add_argument("cmd", nargs="?", default="status", choices=["prep", "merge", "status"], help="不写就是 status")
    ap.add_argument("ids", nargs="*", help="试卷 id；merge/status 不写就是全部")
    ap.add_argument("--part", help="prep 只输出某类：subjective listening banked matching reading cloze order")
    ap.add_argument("--all", action="store_true", help="prep 连已有 fields 的题也列出来")
    ap.add_argument("--full", action="store_true", help="prep 现有解析不截断")
    ap.add_argument("--force", action="store_true", help="merge：覆盖已有的 fields")
    ap.add_argument("--lenient", action="store_true", help="merge：quote 在卷面匹配不到、其余都过的，也写入并标 fieldsFlag")
    ap.add_argument("--only", help="merge：只处理这几道题（逗号分隔 id）")
    ap.add_argument("--work", default=os.environ.get("STRUCTURE_WORK") or str(WORK_DEFAULT), help="工作目录：inputs/ 和 batches/")
    args = ap.parse_args()
    work = Path(args.work)
    global EXPLAIN_MAX
    if args.full:
        EXPLAIN_MAX = 0

    if args.cmd == "prep":
        if not args.ids:
            ap.error("prep 要写试卷 id")
        for pid in args.ids:
            txt = build_input(pid, args.part, pending_only=not args.all)
            d = work / "inputs"
            d.mkdir(parents=True, exist_ok=True)
            out = d / f"{pid}{'.' + args.part if args.part else ''}.txt"
            out.write_text(txt, "utf-8")
            print(f"{out}  （{len(txt)} 字）")
        return

    ids = args.ids or paper_ids()
    if args.cmd == "merge":
        only = set(args.only.split(",")) if args.only else None
        tot = {"written": 0, "skipped": 0, "failed": 0, "flagged": 0}
        for pid in ids:
            st = merge_paper(pid, work, force=args.force, lenient=args.lenient, only=only)
            if not st["batch"]:
                continue
            for k in tot:
                tot[k] += st[k]
            print(f"{pid}: 批次 {st['batch']} 题，写入 {st['written']}，跳过（已有）{st['skipped']}，未通过 {st['failed']}，标记 {st['flagged']}")
        print("合计", tot)
        print()
    print_status(ids)


if __name__ == "__main__":
    main()
