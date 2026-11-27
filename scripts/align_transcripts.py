"""听力逐字稿：把解析 PDF 里的"听力原文"对到录音的每一句上，写进 audio.segments[].lines[].text / speaker。

来源：真题/<级别>/<年月>/…-解析.pdf 里每个题组的听力原文（有文字层的直接取，扫描件用高清重新识别，
识别结果缓存在 data/cache/cet-script-ocr/）。题组的读题（"Questions 1 and 2 are based on…"、"Question 1."
和题干）从原文里或解析里的题目取。

做法：
  1. 切出每个题组的原文：按标题 News Report One / Conversation One / Passage One / Recording One 分段，
     取标题后面连续的英文行，碰到汉字（答案详解、听前预测）或题号 "1." 就停；去掉页脚、定位标记 [1] (2-1)
  2. 分句：按 . ? ! 切（不在 Mr. U.S. p.m. 这类缩写后切），M:/W: 开头的是说话人，换人处一定断句
  3. 对到时间：录音每段已经按静音切成"行"（只有 start/end）。每行的时长应该和分到它的字数成正比（约 15 字符/秒）。
     用动态规划找各行分到哪几个词，代价 = 时长和字数的偏差 + 把一行切在句子中间的惩罚；
     "Question N" 行是锚点（import_cet.py 按作答静音标出来的），把动态规划切成小段
  4. 按句重切：对完以后 lines 改成一句一行（不再是按停顿切的碎片）。一句跨几个碎片的，取第一个的 start、最后一个的 end；
     一个碎片里有句子分界的，按字符数比例切开时间。读题 "Question N." 和它的题干合成一行；没有文字的行（作答静音、杂音）去掉。
     每行按已知的固定说法标 kind：directions（指导语）、cue（Questions 1 and 2 are based on…）、question（读题）；原文没有 kind
  5. 段的 id、start、end 不动。按停顿切的原始行存在 data/cache/cet-audio-lines/，单独重跑本脚本时从那里重新对齐

用法：
  python -I scripts/align_transcripts.py                  给 public/papers/ 里所有有录音的卷子对齐（没有解析 PDF 的样卷只按句重切、标 kind）
  python -I scripts/align_transcripts.py cet4-2024-06-1   只对这几套
  python -I scripts/align_transcripts.py --report         只打印报告，不写文件
  python -I scripts/align_transcripts.py --show cet4-2024-06-1   打印这一套对齐后的每一句（带时长和 kind），人工看
  python -I scripts/align_transcripts.py --relink-explain 给解析层（public/papers/explain/）里听力题的 fields.locate 补 line（逐字稿句号）
import_cet.py 导入时会调用 align_paper()，重新导入不会丢逐字稿。
"""
import argparse
import copy
import io
import json
import math
import os
import re
import sys
import time
from pathlib import Path

import fitz
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cet_ocr  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PAPERS = ROOT / "public/papers"
EXPLAIN = PAPERS / "explain"
HQ_CACHE = ROOT / "data/cache/cet-script-ocr"
RAW_CACHE = ROOT / "data/cache/cet-audio-lines"  # 按停顿切的原始行（对齐的输入），按句重切以后就只在这里有

CJK = re.compile(r"[一-鿿]")
RATE = 15.0  # 字符/秒（含空格），整段会按实际校准


# ---------- 高清识别（只给听力原文那几页用） ----------

def _recognize_wide(crop, cap=4800):
    """识别一行文字。cet_ocr.recognize 把宽度压到 1600 以内，长行会丢字母；这里放宽到 4800"""
    import cv2

    _, rec, chars = cet_ocr._models()
    h, w = crop.shape[:2]
    nw = max(16, min(cap, int(math.ceil(48 * w / h))))
    x = cv2.resize(crop, (nw, 48)).astype(np.float32) / 255.0
    x = ((x[:, :, ::-1] - cet_ocr.MEAN) / cet_ocr.MEAN).transpose(2, 0, 1)[None].astype(np.float32)
    out = rec.run(x)[0]
    idx = out.argmax(1)
    space = len(chars) - 1
    text, last = [], 0
    for t, i in enumerate(idx):
        # 字距紧的扫描件，模型常把词间空格当成空白：空格的概率不低就当空格（不加这条，整行的词会粘在一起）
        if i == 0 and out[t, space] > 0.08:
            i = space
        if i != 0 and i != last:
            text.append(chars[i] if i < len(chars) else "")
        last = i
    return "".join(text)


def ocr_page_hq(page, dpi=300, hint=None):
    """300dpi、检测框外扩小一点（框里的字更大）、识别宽度放宽：英文原文几乎没有错字。返回 [{text,x0,y0,x1,y1}]（PDF 点）。
    hint 是第一遍识别的行 [(文字, x0, y0, x1, y1)]：和它重叠、而且以汉字为主的框直接用第一遍的结果，不再识别（汉字解析占了大半，不需要）"""
    pm = page.get_pixmap(dpi=dpi, alpha=False)
    img = np.frombuffer(pm.samples, dtype=np.uint8).reshape(pm.height, pm.width, 3)[:, :, ::-1].copy()
    k = 72 / dpi
    out = []
    for x0, y0, x1, y1, _ in cet_ocr.merge_rows(cet_ocr.detect(img, unclip=1.0, max_side=min(max(img.shape[:2]), 2560))):
        if hint:
            cy = (y0 + y1) / 2 * k
            hit = next((h for h in hint if h[2] <= cy <= h[4] and min(h[3], x1 * k) - max(h[1], x0 * k) > 0.5 * min(h[3] - h[1], (x1 - x0) * k)), None)
            if hit and len(CJK.findall(hit[0])) >= 0.4 * max(len(hit[0]), 1):
                out.append({"text": hit[0], "x0": x0 * k, "y0": y0 * k, "x1": x1 * k, "y1": y1 * k})
                continue
        crop = img[int(y0) : int(math.ceil(y1)), int(x0) : int(math.ceil(x1))]
        if crop.shape[0] < 6 or crop.shape[1] < 6:
            continue
        text = _recognize_wide(crop)
        if text.strip():
            out.append({"text": text, "x0": x0 * k, "y0": y0 * k, "x1": x1 * k, "y1": y1 * k})
    return out


def _first_pass_hint(pdf, i):
    """第一遍识别（data/cache/cet-ocr/）里这一页的行，没有就是 None"""
    c = cet_ocr.load_cache(pdf)
    return [(t, a, b, c_, d) for t, a, b, c_, d, _ in c[i]] if i in c else None


def _hq_cache_file(pdf):
    return HQ_CACHE / (Path(pdf).stem + ".json")


def _load_hq(pdf):
    p = _hq_cache_file(pdf)
    if p.exists():
        try:
            return {int(k): v for k, v in json.loads(p.read_text("utf-8")).items()}
        except ValueError:
            pass
    return {}


def _save_hq(pdf, pages):
    HQ_CACHE.mkdir(parents=True, exist_ok=True)
    _hq_cache_file(pdf).write_text(json.dumps({str(k): v for k, v in sorted(pages.items())}, ensure_ascii=False, separators=(",", ":")), "utf-8")


def glued(rows):
    """文字层里英文词粘在一起（NewsReportOne、Whatisreportedinthenews）：十五个字母以上的"词"占比高"""
    words = [w for r in rows for w in re.findall(r"[A-Za-z]+", r["text"])]
    return len(words) >= 40 and sum(1 for w in words if len(w) >= 15) / len(words) > 0.05


def text_usable(rows):
    """文字层能不能直接用：识别得出来、而且词没有粘在一起"""
    return cet_ocr.text_ok(rows) and not glued(rows)


class PageSource:
    """解析 PDF 的页面文字行（按需读取）：文字层能用就用文字层，否则用高清识别（缓存）。
    每行 {text, x0, y0, x1, y1, h}，h 是页高，用来去掉页脚"""

    def __init__(self, pdf, allow_ocr=True, pages=None):
        self.pdf = Path(pdf)
        self.doc = fitz.open(self.pdf)
        self.n = len(self.doc)
        self.pages = set(pages) if pages is not None else None  # 只读这几页（听力原文所在的页），别的页当空页
        self.allow_ocr = allow_ocr
        self.cache = _load_hq(self.pdf)
        self.first = cet_ocr.load_cache(self.pdf) if not allow_ocr else {}
        self.dirty = False
        self.memo = {}
        self.ocr_done = 0

    def lines(self, i):
        if i in self.memo:
            return self.memo[i]
        if self.pages is not None and i not in self.pages:
            return []
        page = self.doc[i]
        h = page.rect.height
        tl = cet_ocr.text_lines(page)
        if text_usable(tl):
            rows = [dict(l) for l in tl]
        elif i in self.cache:
            rows = [{"text": t, "x0": a, "y0": b, "x1": c, "y1": d} for t, a, b, c, d in self.cache[i]]
        elif self.allow_ocr:
            rows = ocr_page_hq(page, hint=_first_pass_hint(self.pdf, i))
            self.cache[i] = [[r["text"], round(r["x0"], 1), round(r["y0"], 1), round(r["x1"], 1), round(r["y1"], 1)] for r in rows]
            self.dirty = True
            self.ocr_done += 1
        elif i in self.first:
            # 不在本机识别（--no-ocr）时，没有高清识别的页用导入时的第一遍识别（data/cache/cet-ocr/）
            rows = [{"text": r[0], "x0": r[1], "y0": r[2], "x1": r[3], "y1": r[4]} for r in self.first[i]]
        else:
            rows = None
        if rows is not None:
            rows = cet_ocr.order_columns(rows, page.rect.width) if len(rows) >= 16 else rows
            for r in rows:
                r["h"] = h
                r["w"] = page.rect.width
                r["page"] = i + 1
        self.memo[i] = rows
        return rows

    def save(self):
        if self.dirty:
            _save_hq(self.pdf, self.cache)
            self.dirty = False




class FirstPass:
    """只读已有的结果找页码：文字层能用就用文字层，否则用 data/cache/cet-ocr/ 里的第一遍识别（没有就是 None）。
    用来判断听力原文在哪几页，好把这几页拿去高清识别"""

    def __init__(self, pdf):
        self.pdf = Path(pdf)
        self.doc = fitz.open(self.pdf)
        self.n = len(self.doc)
        self.cache = cet_ocr.load_cache(self.pdf)

    def lines(self, i):
        page = self.doc[i]
        tl = cet_ocr.text_lines(page)
        if cet_ocr.text_ok(tl):
            rows = [dict(l) for l in tl]
        elif i in self.cache:
            rows = [{"text": t, "x0": a, "y0": b, "x1": c, "y1": d} for t, a, b, c, d, _ in self.cache[i]]
        else:
            return None
        for r in rows:
            r["h"] = page.rect.height
            r["w"] = page.rect.width
            r["page"] = i + 1
        return rows


def script_pages(pdf, exam, groups):
    """听力原文所在的页（从 0 开始）：从第一个标题所在页，到最后一个标题的下一页。找不到返回 []"""
    fp = FirstPass(pdf)
    starts, lines = find_blocks(fp, expected_kinds(exam, groups), [(g["lo"], g["hi"]) for g in groups])
    got = [st for st in starts if st]
    if not got:
        return []
    return list(range(lines[got[0][0]]["page"] - 1, min(fp.n, lines[got[-1][0]]["page"] + 1)))


def _hq_job(args):
    pdf, i = args
    fitz.TOOLS.mupdf_display_errors(False)
    doc = fitz.open(pdf)
    rows = None
    for dpi in (300, 220):  # 个别页内存不够，降分辨率再试
        try:
            rows = ocr_page_hq(doc[i], dpi=dpi, hint=_first_pass_hint(pdf, i))
            break
        except Exception:
            continue
    if rows is None:
        return pdf, i, None
    return pdf, i, [[r["text"], round(r["x0"], 1), round(r["y0"], 1), round(r["x1"], 1), round(r["y1"], 1)] for r in rows]


def prefetch(jobs, workers=8, log=print):
    """jobs: [(pdf, 页序号)]。多进程做高清识别，每份 PDF 识别完就写缓存"""
    from concurrent.futures import ProcessPoolExecutor, as_completed

    todo = {}
    for pdf, i in jobs:
        todo.setdefault(str(pdf), []).append(i)
    caches = {pdf: _load_hq(pdf) for pdf in todo}
    pending = {pdf: [i for i in dict.fromkeys(ii) if i not in caches[pdf]] for pdf, ii in todo.items()}
    work = [(pdf, i) for pdf, ii in pending.items() for i in ii]
    if not work:
        return
    left = {pdf: len(ii) for pdf, ii in pending.items()}
    log(f"高清识别 {len(work)} 页（{len([p for p in left if left[p]])} 份解析）……")
    done, failed = 0, []
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futs = [pool.submit(_hq_job, w) for w in work]
        for fut in as_completed(futs):
            try:
                pdf, i, rows = fut.result()
            except Exception as e:  # 进程被杀（内存不够）：这页跳过，其他页照常
                failed.append(repr(e))
                continue
            done += 1
            if rows is None:
                failed.append(f"{Path(pdf).name} 第 {i + 1} 页识别失败")
                continue
            caches[pdf][i] = rows
            _save_hq(pdf, caches[pdf])  # 每页都存，中途断了不丢
            left[pdf] -= 1
            if left[pdf] == 0:
                log(f"  {Path(pdf).name} 完成（{done}/{len(work)} 页）")
    for f in failed:
        log("  失败：" + f)


# ---------- 切出每个题组的原文 ----------

# 卷面版式：{(lo, hi): 种类}；种类决定标题 News Report / Conversation / Passage / Recording
TEMPLATES = {
    "cet4": [(1, 2, "news"), (3, 4, "news"), (5, 7, "news"), (8, 11, "conv"), (12, 15, "conv"), (16, 18, "pass"), (19, 21, "pass"), (22, 25, "pass")],
    "cet6": [(1, 4, "conv"), (5, 8, "conv"), (9, 11, "pass"), (12, 15, "pass"), (16, 18, "rec"), (19, 21, "rec"), (22, 25, "rec")],
}
KIND_WORDS = {
    "news": r"news\s*(?:reports?|items?)",
    "conv": r"(?:short\s*)?(?:conversations?|dialog(?:ue)?s?)",
    "pass": r"passages?|lectures?|talks?|speeches|monologues?|recordl?ings?",
    "rec": r"recordl?ings?|lectures?|talks?|speeches|interviews?|passages?",
}
SPOKEN_KIND = {"news": "news report", "conv": "conversation", "pass": "passage", "rec": "recording"}
ORD = {"one": 1, "0ne": 1, "oue": 1, "ono": 1, "two": 2, "tw0": 2, "twe": 2, "three": 3, "thre": 3, "thr3e": 3, "thee": 3, "four": 4, "f0ur": 4, "five": 5, "six": 6,
       "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "i": 1, "ii": 2, "iii": 3}
HEADER = re.compile(r"^\W*(?:section\s*[abc]\W*)?(news\s*(?:reports?|items?)|short\s*conversations?|conversations?|dialog(?:ue)?s?|passages?|recordl?ings?|lectures?|talks?|speeches|monologues?|interviews?)\W*([a-z0-9]{1,6})\W*$", re.I)
FOOTER = re.compile(r"四级|六级|真题|第\s*[一二三123]\s*套|第\s*\d+\s*页|20\d\d\s*[./]\s*\d+\s*[/／]\s*\d+")
PAGE_NO = re.compile(r"^\W*\d{1,3}\W*$")
LEAD = re.compile(r"^\W*Questions?\s*(\d{1,2})\s*(?:and|to|-|–|—)\s*(\d{1,2})\s*(?:are\s*)?based", re.I)
NUMBERED = re.compile(r"^[\s:：;·.|]*(\d{1,2})\s*[.．:：]\s*(.*)$")
OPTION = re.compile(r"^\W{0,2}[A-D]\s*[).）]")
STEM_START = re.compile(r"^(?:\d{1,2}\s*[.．]?\s*)?(?:What|Why|How|Which|Where|When|Who|Whom|Whose|Do|Does|Did|Is|Are|Was|Were|Will|Would|Can|Could|Should|Has|Have)\b")
SPEAKER = re.compile(r"(?:^|(?<=[\s.?!\"')]))(M|W|VV)\s*[:;]\s*")
MARK = re.compile(
    r"[\[\(（［]\s*(?:\d{1,2}|[iIl|]{1,2}|[iIl|]\s?\d|\d[oOlI]|[oO]\d)(?:\s*[-—–﹣]\s*\d)?\s*(?:[\]\)）］]|[jJ!|](?=\s*[A-Z])|[lI|](?=\s|$)|[lI](?=\s*[A-Za-z]))"
    r"|(?<=\s)\d{1,2}\s*[\]］](?=\s|$)|(?<=\s)[\[［]\s*\d{1,2}(?=\s|$)|[\[［]\s*\d{1,2}\s*(?=[A-Z])|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]"
)
HEADING_ROW = re.compile(r"^\W*(?:part\s*[ivx1-4]+|section\s*[a-c]?|listening\s*comprehension|\(?\d+\s*minutes\)?)\W*$", re.I)


def norm(t):
    return (t.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace("＂", '"').replace("´", "'").replace("`", "'")
             .replace("？", "?").replace("！", "!").replace("，", ",").replace("．", ".").replace("：", ":").replace("；", ";")
             .replace("（", "(").replace("）", ")").replace("—", "-").replace("–", "-").replace("﹣", "-").replace("…", "..."))


def is_footer(row):
    t = row["text"]
    if FOOTER.search(t) and len(re.sub(r"[\d\s./（）()·\-]", "", t)) < 24:
        return True
    return bool(PAGE_NO.match(t)) and row["y0"] > 0.85 * row.get("h", 1e9)


ORD_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6}


def ordinal_of(tok):
    """One / Two / Three（识别常把 One 认成 0ne、On，Three 丢字母）。认不出返回 None"""
    tok = tok.lower()
    if tok in ORD:
        return ORD[tok]
    t = tok.replace("0", "o").replace("1", "l")
    for w, n in ORD_WORDS.items():
        if len(t) >= 2 and w.startswith(t):
            return n
    return None


def header_of(text):
    """这一行是不是题组标题（News Report One 这类）：返回 (关键词, 序号或 None)，不是返回 None"""
    t = CJK.sub("", text).strip()
    if len(t) > 50:
        return None
    m = HEADER.match(norm(t))
    if not m:
        return None
    return re.sub(r"\s+", " ", m.group(1).lower()), ordinal_of(m.group(2))


def kind_ok(kind, word):
    return bool(re.fullmatch(KIND_WORDS[kind], word))


def expected_kinds(exam, groups):
    """每个听力题组的种类：卷面版式对得上的按版式，否则按题组自己的种类"""
    tpl = {(a, b): k for a, b, k in TEMPLATES[exam]}
    return [tpl.get((g["lo"], g["hi"])) or g.get("kind") or "pass" for g in groups]


def lead_numbers(text):
    m = LEAD.match(norm(CJK.sub(" ", text)))
    return (int(m.group(1)), int(m.group(2))) if m else None


def find_blocks(src, kinds, spans, min_page=0):
    """每个题组的起点：先按标题 News Report One 找，找不到的再按 "Questions 1 and 2 are based on…" 那一行找
    （有的版式没有标题，读题句在原文前面）。返回 (起点列表 [(行号, 是不是读题句)]，扁平行列表)。
    逐页读，找齐了再多读一页就停（扫描件识别很慢，只处理听力原文那几页）"""
    lines, starts, i = [], [None] * len(kinds), min_page
    pos = 0
    while i < src.n:
        rows = src.lines(i)
        if rows is None:
            break
        lines.extend(rows)
        i += 1
        # 标题：按顺序，每个题组在上一个已找到的标题之后
        for gi, k in enumerate(kinds):
            if starts[gi] is not None:
                pos = starts[gi][0] + 1
                continue
            want = sum(1 for x in kinds[: gi + 1] if x == k)
            prev = max([st[0] for st in starts[:gi] if st] or [-1])
            hit = None
            for j in range(prev + 1, len(lines)):
                h = header_of(lines[j]["text"])
                if h and kind_ok(k, h[0]) and h[1] in (want, None):
                    hit = j
                    break
            if hit is not None:
                starts[gi] = (hit, False)
        # 读题句："Questions lo and hi are based on…"，数字对得上的第一行
        for gi, (lo, hi) in enumerate(spans):
            if starts[gi] is not None:
                continue
            prev = max([st[0] for st in starts[:gi] if st] or [-1])
            for j in range(prev + 1, len(lines)):
                if lead_numbers(lines[j]["text"]) == (lo, hi):
                    starts[gi] = (j, True)
                    break
        got = [st for st in starts if st]
        # 找齐标题后再读一页（"录音分析"版式最后一组的原文要往后好几页，PageSource.tail_pages 设成 3）
        if len(got) == len(kinds) and i >= lines[got[-1][0]]["page"] + getattr(src, "tail_pages", 1):
            break
        if not got and i >= min_page + 10:
            break
        # 还差几组没找到：再往后找几页（"录音分析""听时记什么"版式一组占三四页，中间漏认一个标题就要隔五六页）
        if got and len(got) < len(kinds) and i >= lines[got[-1][0]]["page"] + 4 + 2 * (getattr(src, "tail_pages", 1) > 1):
            break
    return starts, lines


def clean_row(t):
    t = norm(t)
    t = re.sub(r"^[\s:;·|]+(?=[MW]\s*[:;])", "", t)  # 行首的图标残留 ":W:"
    t = CJK.sub(" ", t)
    t = re.sub(r"[_|]+", " ", t)
    # 行里孤零零的 ":" "↓" "----"（版面图标、下划线识别出来的残留）；说话人的 "M:" "W:" 是贴着字母的，不受影响
    t = re.sub(r"(?:(?<=\s)|^)[:;↓↑·•\-]{1,8}(?=\s|$)", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def script_block(region, lo):
    """标题后面的原文：连续的英文行，遇到汉字行（答案详解、听前预测）或第一题的题号就停。
    返回 (原文行文字列表, 剩下的行)"""
    out, started = [], False
    for k, row in enumerate(region):
        if is_footer(row):
            continue
        t = row["text"]
        if len(CJK.findall(t)) >= 3:
            if row["x0"] > 0.5 * row.get("w", 1e9):
                continue  # 左英右中对照排版：右栏的译文不是原文的结束
            if started:
                return out, region[k:]
            continue
        m = NUMBERED.match(norm(t))
        if started and m and int(m.group(1)) == lo and (not m.group(2).strip() or m.group(2).lstrip()[:1].isupper()):
            return out, region[k:]
        c = clean_row(t)
        if not c or HEADING_ROW.match(re.sub(r"\s+", " ", c)) or HEADING_ROW.match(re.sub(r"(?<=[a-z])(?=[A-Z])", " ", c)):
            continue
        if not started and (len(c) < 4 or not re.search(r"[A-Za-z]{3}", c)):
            continue
        started = True
        out.append(c)
    return out, []


_TINT = {}


def _on_tint(doc, row):
    """这一行的底色是不是浅蓝（解析书把听力原文印在浅蓝底框里）：取行框里像素的中位色"""
    key = (doc.name, row["page"])
    if key not in _TINT:
        if len(_TINT) > 40:
            _TINT.clear()
        _TINT[key] = doc[row["page"] - 1].get_pixmap(dpi=40)
    pix, z = _TINT[key], 40 / 72
    xs = range(max(0, int(row["x0"] * z)), min(pix.width, int(row["x1"] * z) + 1))
    ys = range(max(0, int(row["y0"] * z)), min(pix.height, int(row["y1"] * z) + 1))
    px = [pix.pixel(x, y) for x in xs for y in ys]
    if not px:
        return False
    r, b = sorted(p[0] for p in px)[len(px) // 2], sorted(p[2] for p in px)[len(px) // 2]
    return b - r > 25 and b > 180


BOX_HEAD = re.compile(r"录音分析")
BOX_END = re.compile(r"试题精析|全文翻译|答案精析|试题详解")


def boxed_block(region, doc):
    """"录音分析"版式（2016–2020 年不少六级解析书）：每个题组先是"听前预测"（卷面选项），再是"录音分析"——
    原文按"1-M: …""2-W: …"分段印在浅蓝底框里，框之间夹着中文分析，然后才是"试题精析"。
    只取"录音分析"里浅蓝底的英文行。不是这种版式返回 None。返回 (原文行文字列表, 剩下的行)"""
    k0 = next((k for k, r in enumerate(region) if BOX_HEAD.search(r["text"])), None)
    if k0 is None or doc is None:
        return None
    k1 = next((k for k in range(k0 + 1, len(region)) if BOX_END.search(region[k]["text"])), len(region))
    out = []
    for r in region[k0 + 1 : k1]:
        if is_footer(r) or len(CJK.findall(r["text"])) >= 3 or not _on_tint(doc, r):
            continue
        c = clean_row(re.sub(r"^\s*\d{1,2}\s*[-－—–]\s*(?=[MW]\s*[:;：])", "", norm(r["text"])))
        c = re.sub(r"^\d{1,2}\s*[-－—–]\s*", "", c)  # 短文的段号 "3-"
        if c and re.search(r"[A-Za-z]{2}", c):
            out.append(c)
    return (out, region[k1:]) if out else None


SCRIPT_HEAD = re.compile(r"听力原文|听时记什么|录音原文|原文再现|听力材料|原文翻译")


def marked_block(region, lo, hi):
    """原文前面有小标题的版式：题组标题后面先是逐题选项分析或"听前预测"（卷面选项，英文），
    再是"听力原文""二、听时记什么"（左英右中对照，行首"1—M:"）这样的小标题，下面才是原文。
    从小标题后面取（取法同 script_block）。没有这种小标题返回 None"""
    k0 = next((k for k, r in enumerate(region) if SCRIPT_HEAD.search(r["text"]) and len(r["text"].strip()) <= 20), None)
    if k0 is None:
        return None
    rows = []
    for r in region[k0 + 1 :]:
        r = dict(r)
        t = norm(r["text"]).replace("∶", ":")  # 有的书说话人后面是比号 "M∶"
        t = re.sub(r"^\s*\d{1,2}\s*[—–\-－]+\s*(?=[MW]\s*[:;：])", "", t)
        t = re.sub(r"^\s*Q\s*[l1I|\d]{1,2}\s*[,:：.]\s*(?=[A-Z])", "", t)  # 末尾读题 "Q1: What does…?"
        t = re.sub(r"(?<![一-鿿])[一-鿿](?![一-鿿])", " ", t)  # 英文里孤零零一个汉字：版面图标（"Myers. 回 Myers is" "回Do you"）
        m = re.search(r"[一-鿿]{2,}", t)
        if m and re.match(r"\s*[A-Za-z\"'(ⅠⅡⅢⅣⅤⅥ]", t) and len(re.findall(r"[A-Za-z]", t[: m.start()])) >= 8:
            t = t[: m.start()]  # 左英右中挤在一行（文字层或识别时两栏没分开）：只留左边的英文
        r["text"] = t
        rows.append(r)
    block, tail = script_block(rows, lo)
    if block and qmark_evidence(block, lo, hi):
        block = [strip_qmarks(t, lo, hi) for t in block]
    return (block, tail) if block else None


NUM_BEFORE = set("in for about around nearly almost over under than only just have has had the to of at by with from after before within last next first every some these those top all".split())
NUM_UNIT = re.compile(r"(?:years?|months?|days?|weeks?|hours?|minutes?|seconds?|times?|people|percent|per|million|billion|thousand|hundred|dollars?|pounds?|miles?|kilometers?|degrees?|children|kids|of|or|and|to|st|nd|rd|th)\b")


QMARK_TOK = re.compile(r"^(\d{1,2})([A-Da-d]?)(.*)$")


def qmark_evidence(lines, lo, hi):
    """这组原文里有没有"题号+答案字母"上标（"13B" "16It" "4 ccomes"）：至少两处才算这本书标了"""
    n = 0
    for t in lines:
        for tok in t.split():
            m = QMARK_TOK.match(tok)
            if m and lo <= int(m.group(1)) <= hi + 1 and (m.group(2) or m.group(3)[:1].isalpha()) and not re.match(r"(st|nd|rd|th)\b", m.group(3)):
                n += 1
    return n >= 2


_WORDS = None


def is_word(w):
    """应用自带词典（public/dict，词条和变形）里有没有这个词"""
    global _WORDS
    if _WORDS is None:
        d = ROOT / "public" / "dict"
        _WORDS = set(json.loads((d / "lemma.json").read_text("utf-8")))
        for f in (d / "shards").glob("*.json"):
            _WORDS.update(json.loads(f.read_text("utf-8")))
        _WORDS = {x.lower() for x in _WORDS}
    w = re.sub(r"[^A-Za-z'-]", "", w).lower()
    return w in _WORDS or w.rstrip("'s") in _WORDS


def strip_qmarks(t, lo, hi):
    """去掉原文里的"题号+答案字母"上标：有的解析书在原文出题处标 ⁴C 这样的上标，识别成 "it 4 ccomes"
    "13B The" "1Ba cold" "16It"。只在 qmark_evidence 认定这组有标记时调用；单位词前的数字（"2 months"）和序数不动"""
    toks, out, k = t.split(), [], 0
    while k < len(toks):
        tok = toks[k]
        m = QMARK_TOK.match(tok)
        nxt = toks[k + 1] if k + 1 < len(toks) else ""
        if m and lo <= int(m.group(1)) <= hi + 1 and not re.match(r"(st|nd|rd|th|s)\b|%", m.group(3)) and not (not m.group(3) and NUM_UNIT.match(nxt)) and not (out and out[-1] in ("$", "£")):
            rest = m.group(3) if m.group(3) else ""
            if not m.group(2) and not rest and not re.match(r"[A-Za-z\"'“]", nxt):
                out.append(tok)  # 后面不是词（"6 , 000"），当正常数字
                k += 1
                continue
            if m.group(2) and rest and rest[:1].islower() and m.group(2).isupper():
                pass  # "1Ba" → "a"
            elif m.group(2) and rest:
                rest = m.group(2) + rest  # "6in"："i" 不是答案字母，算词的一部分
            if rest:
                out.append(rest)
            elif re.match(r"[a-dA-D][a-z]", nxt) and not is_word(nxt) and is_word(nxt[1:]):
                toks[k + 1] = nxt[1:]  # "4 ccomes" "16 cstuck"：答案字母粘在下一个词上（去掉后才是词）
            k += 1
            continue
        out.append(tok)
        k += 1
    return " ".join(out)


def find_stems(tail, lo, hi):
    """解析里每道题的题干（英文）：行首 "N." 后面的英文，碰到汉字截断，换行的接上。返回 {题号: 题干}"""
    stems, cur = {}, None
    for row in tail:
        if is_footer(row):
            continue
        t = norm(row["text"])
        m = NUMBERED.match(t)
        if m and lo <= int(m.group(1)) <= hi and int(m.group(1)) not in stems:
            cur = int(m.group(1))
            rest = m.group(2)
            j = CJK.search(rest)
            stems[cur] = (rest[: j.start()] if j else rest).strip()
            if j and rest[: j.start()].strip() == "" and rest[j.start() : j.start() + 2] == "答案":
                continue  # "1.答案 D"：题干在下一行（英文）
            if j:
                cur = None
            continue
        if cur is not None:
            if OPTION.match(t) or (m and 1 <= int(m.group(1)) <= 25) or CJK.search(t[:3]):
                cur = None
                continue
            j = CJK.search(t)
            stems[cur] = (stems[cur] + " " + (t[: j.start()] if j else t)).strip()
            if j:
                cur = None
    out = {}
    for n, st in stems.items():
        st = fix_spacing(MARK.sub(" ", re.sub(r"\s+", " ", st))).strip()
        st = re.sub(r"\s+", " ", st)
        if len(re.findall(r"[A-Za-z]{2,}", st)) >= 3 and quality(st) >= 0.7 and not OPTION.match(st):
            out[n] = st
    return out


# ---------- 清理文字、分句 ----------

_RANK = {}


def ranks():
    """词频表（ECDICT，复用 polish_explanations 的词表）：词 → 排名，越小越常用"""
    if not _RANK:
        import polish_explanations as pe

        pe.lexicon()
        _RANK.update(pe._rank)
        _RANK.update({"a": 1, "i": 1, "ok": 3000, "tv": 3000, "ms": 20000})
    return _RANK


SUFFIX = {"s", "t", "ll", "ve", "re", "d", "m"}
# 拆词时两个字母的碎片只认这些（Fayetteville 不能拆成 Faye tt evil le）
SHORT2 = {"am", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is", "it", "me", "my", "no", "of", "on", "or", "so", "to", "up", "us", "we", "ok", "oh"}


def split_joined(tok):
    """粘在一起的英文词拆开：aftera → after a，I'vebeensobusy → I've been so busy。拆不出来的原样返回。
    首字母大写又不认识的词（人名地名）不拆；MainStreet 这样的驼峰在大小写交界处拆"""
    rk = ranks()
    low = tok.lower()
    if len(tok) < 6 or (low in rk and rk[low] < 60000):
        return tok
    camel = re.sub(r"(?<=[a-z]{2})(?=[A-Z][a-z]{2})", " ", tok)
    if camel != tok and all(len(p) >= 3 for p in camel.split()):
        return " ".join(split_joined(p) for p in camel.split())
    n = len(low)
    best = [0.0] + [math.inf] * n
    back = [0] * (n + 1)
    for i in range(1, n + 1):
        for j in range(max(0, i - 20), i):
            w = low[j:i]
            if "'" in w:
                base, _, suf = w.partition("'")
                if suf not in SUFFIX or base not in rk or not base:
                    continue
                r = rk[base]
                ln = len(base)
            else:
                r = rk.get(w)
                if r is None:
                    continue
                ln = len(w)
            if (ln == 1 and w[0] not in ("a", "i")) or (ln == 2 and w[:2] not in SHORT2) or (ln <= 3 and r > 9000) or (ln == 4 and r > 40000) or r > 90000:
                continue
            c = best[j] + math.log(r + 3) + 2.5
            if c < best[i]:
                best[i], back[i] = c, j
    if math.isinf(best[n]):
        return tok
    parts, i = [], n
    while i > 0:
        parts.append(tok[back[i] : i])
        i = back[i]
    parts.reverse()
    if tok[:1].isupper() and low not in rk and len(parts) < 3:
        return tok  # 人名、地名（Norwalk 不能拆成 Nor walk）
    return " ".join(parts) if len(parts) > 1 else tok


def fix_spacing(t):
    """英文标点后面丢了的空格、粘在一起的词、数字和字母粘在一起"""
    t = re.sub(r"(?<=[a-z]{2})([.!?])(?=[A-Z])", r"\1 ", t)
    t = re.sub(r"(?<=\.m\.)(?=[a-z])", " ", t)
    t = re.sub(r"(?<=[a-z]{2})(?=I')", " ", t)
    t = re.sub(r"(\d(?:th|st|nd|rd))(?=[a-z]{2})", r"\1 ", t)
    t = re.sub(r"(?<=[A-Za-z]),(?=[A-Za-z])", ", ", t)
    t = re.sub(r"(?<=[a-z])([;:?!])(?=[A-Za-z])", r"\1 ", t)
    t = re.sub(r"(?<=[a-z]{2})\)(?=[A-Za-z])", ") ", t)
    t = re.sub(r"(?<![A-Za-z])\d[\dOo,.]*[\dOo](?![A-Za-z])", lambda m: m.group().replace("o", "0").replace("O", "0"), t)  # 7o,oo0 → 70,000
    t = re.sub(r"[A-Za-z][A-Za-z']{5,}", lambda m: split_joined(m.group()), t)
    t = re.sub(r"(?<=\d)(?=(?:p\.m\.|a\.m\.))", " ", t)
    t = re.sub(r"(\d)(?=[A-Za-z]{3,})(?!(?:th|st|nd|rd)\b)", r"\1 ", t)
    t = re.sub(r"(?<=[a-z])(?=\d)", " ", t)
    return t


def quality(text):
    """文字质量：三个字母以上的词里，词表里有（或首字母大写的专名）的比例"""
    rk = ranks()
    toks = [w for w in re.findall(r"[A-Za-z]+(?:'[a-z]+)?", text) if len(w) >= 3]
    if not toks:
        return 0.0
    ok = sum(1 for w in toks if w.lower() in rk or w[:1].isupper() or w.lower().split("'")[0] in rk)
    return ok / len(toks)


ABBR = {"mr", "mrs", "ms", "dr", "prof", "st", "jr", "sr", "vs", "inc", "ltd", "co", "mt", "u.s", "a.m", "p.m", "e.g", "i.e", "u.k", "ph.d", "gov", "sen", "rep", "gen", "col", "lt", "sgt", "capt", "fig", "vol", "dept", "ave"}
SENT_END = re.compile(r"([.?!]+)([\"')]*)(\s+)(?=[\"'(]?[A-Z0-9])")


def split_sentences(text):
    out, start = [], 0
    for m in SENT_END.finditer(text):
        if m.group(1) == ".":
            prev = re.search(r"([A-Za-z.]+)$", text[start : m.start()])
            orig = prev.group(1) if prev else ""
            if orig.strip(".").lower() in ABBR or (len(orig.strip(".")) == 1 and orig[:1].isupper()):
                continue  # Mr.  U.S.  p.m.  J.（名字缩写）
            if text[m.end() : m.end() + 1].isdigit():
                continue  # No. 36  $37. 50
        out.append(text[start : m.end(2)].strip())
        start = m.end()
    if text[start:].strip():
        out.append(text[start:].strip())
    return [s for s in out if re.search(r"[A-Za-z0-9]", s)]


def turns_of(text):
    """按 M: / W: 切成发言：[(说话人或 None, 文字)]"""
    parts, last, spk = [], 0, None
    for m in SPEAKER.finditer(text):
        seg = text[last : m.start()]
        if seg.strip():
            parts.append((spk, seg))
        spk = "W" if m.group(1) in ("W", "VV") else "M"
        last = m.end()
    if text[last:].strip():
        parts.append((spk, text[last:]))
    return parts


def join_rows(rows):
    t = ""
    for r in rows:
        if t.endswith("-") and r[:1].islower():
            t += r
        else:
            t += (" " if t else "") + r
    return t


def make_sentences(row_texts):
    """原文行 → 句子列表 [{text, speaker}]"""
    text = join_rows(row_texts)
    text = MARK.sub(" ", text)
    text = re.sub(r"\s+", " ", text)
    sents = []
    for spk, seg in turns_of(text):
        seg = fix_spacing(seg.strip())
        for s0 in split_sentences(seg):
            # 读题句粘在上一句后面（"…looked after. " Questions 3 and 4 are based on…"，引号挡住了分句）：切开，后面认得出是读题句
            for s in CUE_INSIDE.split(s0, maxsplit=1):
                s = re.sub(r"\s+", " ", s).strip()
                if s and not re.fullmatch(r"\d{1,2}\s*[.．]?", s):  # 单独一个题号 "4."（题干前面的序号）不算一句
                    sents.append({"text": s, "speaker": spk})
    return sents


CUE_INSIDE = re.compile(r"\s+[\"']?\s*(?=Questions?\s*\d{1,2}\s*(?:and|to|-)\s*\d{1,2}\s*(?:are\s*)?based\s*on)")


def spoken_lead(kind, lo, hi):
    a = f"Questions {lo} and {hi}" if hi - lo == 1 else f"Questions {lo} to {hi}"
    return f"{a} are based on the {SPOKEN_KIND.get(kind, 'passage')} you have just heard."


def extract_group_scripts(src, exam, groups, min_page=0):
    """解析里每个题组的听力原文。返回 [{lo, hi, kind, story:[句子], lead, lead_found, stems:{n:题干}, quality, warn}]；
    找不到的题组 story 为空，warn 里写原因"""
    kinds = expected_kinds(exam, groups)
    starts, lines = find_blocks(src, kinds, [(g["lo"], g["hi"]) for g in groups], min_page)
    out = []
    order = sorted((st[0], gi) for gi, st in enumerate(starts) if st)
    for gi, g in enumerate(groups):
        item = {"lo": g["lo"], "hi": g["hi"], "kind": kinds[gi], "story": [], "lead": None, "lead_found": False, "stems": {}, "quality": 0.0, "warn": []}
        out.append(item)
        if starts[gi] is None:
            item["warn"].append("解析里没找到这一段的标题")
            continue
        j0, lead_first = starts[gi]
        nxt = next((j for j, _ in order if j > j0), len(lines))
        region = lines[j0 + 1 : nxt]
        block, tail = boxed_block(region, getattr(src, "doc", None)) or marked_block(region, g["lo"], g["hi"]) or script_block(region, g["lo"])
        sents = make_sentences(block)
        # 题干直接跟在原文后面、没有题号的版式（"What does Charles say…?" 一句一题）：原文末尾恰好有 题数 句疑问句，就是题干
        stems = find_stems(tail, g["lo"], g["hi"])
        nq = g["hi"] - g["lo"] + 1
        if len(stems) < nq:
            trailing = []
            for s_ in reversed(sents):
                if s_["text"].rstrip().endswith("?") and STEM_START.match(s_["text"]):
                    trailing.append(s_)
                else:
                    break
            if len(trailing) >= nq:
                stems = {g["lo"] + i: re.sub(r"^\d{1,2}\s*[.．]?\s*", "", s_["text"]) for i, s_ in enumerate(reversed(trailing[:nq]))}
                sents = sents[: len(sents) - nq]
        if lead_first:
            item["lead"], item["lead_found"] = clean_row(lines[j0]["text"]), True
        else:
            # 读题句在原文末尾："Questions 1 and 2 are based on…"
            for k in range(len(sents) - 1, -1, -1):
                if LEAD.match(sents[k]["text"]):
                    item["lead"], item["lead_found"] = sents[k]["text"], True
                    sents = sents[:k] + sents[k + 1 :]
                    break
        item["story"] = sents
        if not item["lead"]:
            item["lead"] = spoken_lead(item["kind"], g["lo"], g["hi"])
        item["stems"] = stems
        item["quality"] = quality(" ".join(s_["text"] for s_ in sents))
        if not sents:
            item["warn"].append("没取到原文")
        missing = [n for n in range(g["lo"], g["hi"] + 1) if n not in item["stems"]]
        if missing:
            item["warn"].append(f"没找到题干 {missing}")
    return out


# ---------- 对到时间 ----------

W_COST = 12.0  # 行时长和字数偏差的权重
SKIP_COST = 14.0  # 一行没有原文（指导语、读题没找到题干）的代价
INF = 1e18


def words_of(sents):
    """句子 → 词列表 [{t, len, spk, bt, q}]。bt 是这个词后面断行的代价：句末 0，逗号等 2.5，其他 9，不许断 inf；
    q 是 "Question N" 的 N（放在 Question 这个词上）；si 是所在句子的序号"""
    words = []
    for si, s in enumerate(sents):
        toks = s["text"].split()
        for k, tok in enumerate(toks):
            last = k == len(toks) - 1
            if last:
                bt = 0.0
            elif tok[-1:] in ",;:" or tok.endswith(('",', '";')):
                bt = 2.5
            elif tok.endswith(("-", "—")):
                bt = 14.0
            else:
                bt = 9.0
            w = {"t": tok, "len": len(tok) + 1, "spk": s.get("speaker"), "bt": bt, "q": None, "si": si}
            if s.get("role") == "qnum" and k == 0:
                w["q"] = s["n"]
                w["bt"] = INF if len(toks) > 1 else 0.0  # "Question" 和后面的数字不分开
            words.append(w)
    # "Question N." 前面是个好断点（读题是单独一句）：前一个词的代价降下来
    for j, w in enumerate(words):
        if w["q"] is not None and j > 0:
            words[j - 1]["bt"] = min(words[j - 1]["bt"], 0.0) - 5.0
    return words


def dp_align(durs, words, rate, must_start=None, lmax=65, free_lead=False):
    """每行分到哪几个词：返回 ([(a, b)], 总代价)（词序号，左闭右开）；无解返回 (None, INF)。
    代价 = W·|字数 − 时长·语速| / (期望字数 + 8) + 断点代价 + 一行跨两个说话人的惩罚；允许一行没有词（SKIP_COST）。
    每一行对所有 (起点, 终点) 一次算完（numpy 广播），一个分段几十毫秒"""
    n, m = len(durs), len(words)
    if n == 0 or m == 0:
        return None, INF
    must_start = must_start or {}
    C = np.zeros(m + 1)
    for j, w in enumerate(words):
        C[j + 1] = C[j] + w["len"]
    bp = np.zeros(m + 1)
    for j, w in enumerate(words):
        bp[j + 1] = w["bt"]
    bp[m] = 0.0
    chg = np.zeros(m + 1)
    for j in range(1, m):
        if words[j]["spk"] and words[j - 1]["spk"] and words[j]["spk"] != words[j - 1]["spk"]:
            chg[j] = 1
    P = np.concatenate([[0.0], np.cumsum(chg)])  # P[j] = chg[0..j-1] 之和
    bidx = np.arange(m + 1)[:, None]  # 终点 b
    kk = np.arange(lmax + 1)[None, :]
    aidx = bidx - kk  # 起点 a = b - k
    valid = aidx >= 0
    ac = np.where(valid, aidx, 0)
    x = C[bidx] - C[ac]  # 这一行分到的字数
    inside = np.where(bidx - ac >= 2, P[bidx] - P[np.minimum(ac + 1, bidx)], 0.0)
    cross = 1.5 * inside
    bcost = np.where((bidx > 0) & (bidx < m), bp[bidx], 0.0)
    forbid = (bp[bidx] >= INF / 2) & (bidx > 0) & (bidx < m)  # 不许在这里断行
    dp = np.full((n + 1, m + 1), INF)
    bk = np.zeros((n + 1, m + 1), dtype=np.int32)
    dp[0, 0] = 0.0
    for i in range(1, n + 1):
        e = durs[i - 1] * rate
        ms = must_start.get(i - 1)
        skip_c = np.where(free_lead & (bidx == 0), 2.0, SKIP_COST)
        cost = np.where(x > 0, W_COST * np.abs(x - e) / (e + 8.0), skip_c) + cross
        tot = dp[i - 1][ac] + cost + np.where(x > 0, bcost, 0.0)
        tot = np.where(valid & ~forbid, tot, INF)
        if ms is not None:
            tot = np.where((aidx == ms) & (x > 0), tot, INF)
        k = np.argmin(tot, axis=1)
        best = tot[np.arange(m + 1), k]
        dp[i] = np.minimum(best, INF)
        bk[i] = aidx[np.arange(m + 1), k]
    if dp[n, m] >= INF / 2:
        return None, INF
    spans, b = [], m
    for i in range(n, 0, -1):
        a = int(bk[i, b])
        spans.append((a, b))
        b = a
    spans.reverse()
    return spans, float(dp[n, m])


def align_lines(lines, words, must_start, free_lead=False):
    """对一个分段：语速先按 RATE 试，对完用实际的字数/时长再对一遍。返回 (各行的词范围, 语速, 总代价)"""
    durs = [max(0.05, l["end"] - l["start"]) for l in lines]
    rate = 16.0 if free_lead else RATE
    spans, cost = None, INF
    for _ in range(3):
        sp, c = dp_align(durs, words, rate, must_start, free_lead=free_lead)
        if sp is None:
            sp, c = dp_align(durs, words, rate, None, free_lead=free_lead)
        if sp is None:
            break
        spans, cost = sp, c
        chars = sum(sum(w["len"] for w in words[a:b]) for a, b in sp)
        dur = sum(d for d, (a, b) in zip(durs, sp) if b > a)
        lo_rate = 13.5 if free_lead else 11.0
        new = min(22.0, max(lo_rate, chars / dur)) if dur > 0 else rate
        if abs(new - rate) < 0.3:
            rate = new
            break
        rate = new
    return spans, rate, cost


# 指导语（解析里没有，卷面上有，各年一样）：有的录音在每一节的第一个题组前面念，有的只念第一节；
# 带和不带各对一遍，取代价小的
_TAIL = ["After you hear a question, you must choose the best answer from the four choices marked A), B), C) and D).",
         "Then mark the corresponding letter on Answer Sheet 1 with a single line through the centre."]
_PART = ["Part II Listening Comprehension."]


def _directions(sec, intro, what, nq):
    return [f"Section {sec}.", "Directions: " + intro,
            f"At the end of each {what}, you will hear {nq} questions.",
            f"Both the {what} and the questions will be spoken only once."] + _TAIL


DIRECTIONS = {
    "cet4": {
        0: _PART + _directions("A", "In this section, you will hear three news reports.", "news report", "two or three"),
        3: _directions("B", "In this section, you will hear two long conversations.", "conversation", "four"),
        5: _directions("C", "In this section, you will hear three passages.", "passage", "three or four"),
    },
    "cet6": {
        0: _PART + _directions("A", "In this section, you will hear two long conversations.", "conversation", "four"),
        2: _directions("B", "In this section, you will hear two passages.", "passage", "three or four"),
        4: ["Section C.", "Directions: In this section, you will hear three recordings of lectures or talks followed by some questions.",
            "The recordings will be played only once."] + _TAIL,
    },
}


def group_sentences(item):
    """一个题组的全部句子（按录音里的顺序）：原文、读题句、每题的 Question N. 和题干"""
    sents = [dict(s, role="story") for s in item["story"]]
    sents.append({"text": item["lead"], "speaker": None, "role": "lead"})
    for n in range(item["lo"], item["hi"] + 1):
        sents.append({"text": f"Question {n}.", "speaker": None, "role": "qnum", "n": n})
        if item["stems"].get(n):
            for s in split_sentences(fix_spacing(item["stems"][n])) or [item["stems"][n]]:
                sents.append({"text": s, "speaker": None, "role": "stem", "n": n})
    return sents


QMARK = re.compile(r"^Question (\d+)\b")


def align_segment(seg, item, preamble=None, free_lead=False):
    """给一个录音分段的各行写 text / speaker。preamble 是录音开头的指导语句子（第一个分段才有）：
    带指导语和不带各对一遍，取代价小的（有的录音一开始就是新闻）。返回统计"""
    lines = seg["lines"]
    sents = group_sentences(item)
    title = (seg.get("label") or "").strip()
    if title and not title.endswith("."):
        title += "."
    cands = [None]
    if title:
        cands.append([title])
    if preamble:
        split_pre = []
        for s_ in preamble:
            if s_.startswith("Directions: "):
                split_pre.extend(["Directions:", s_[len("Directions: "):]])
            else:
                split_pre.append(s_)
        cands.append( preamble )
        cands.append(split_pre)
        if title:
            cands.append(split_pre + [title])
    best = None
    for pre in cands:
        allsents = ([{"text": t, "speaker": None, "role": "pre"} for t in pre] if pre else []) + sents
        words = words_of(allsents)
        qstart = {w["q"]: j for j, w in enumerate(words) if w["q"] is not None}
        lead_idx = next((j for j, w in enumerate(words) if allsents[w["si"]].get("role") == "lead"), None)
        if lead_idx is not None and lead_idx > 0:
            words[lead_idx - 1]["bt"] = min(words[lead_idx - 1]["bt"], 0.0) - 5.0
        must, seen = {}, set()
        for i, l in enumerate(lines):
            txt = (l.get("text") or "").strip()
            if lead_idx is not None and "lead" not in seen and CUE_RE.match(txt):
                seen.add("lead")
                must[i] = lead_idx
                continue
            m = QMARK.match(txt)
            if m:
                k = int(m.group(1))
                if item["lo"] <= k <= item["hi"] and k not in seen and k in qstart:
                    seen.add(k)
                    must[i] = qstart[k]
        spans, rate, cost = align_lines(lines, words, must, free_lead=free_lead)
        if spans is not None and (best is None or cost < best[0]):
            best = (cost, spans, rate, words, bool(pre), allsents)
    stat = {"lines": len(lines), "text": 0, "rate": 0.0, "words": 0, "wps": 0.0, "spans": None, "pre": False, "out": None}
    if best is None:
        return stat
    cost, spans, rate, words, stat["pre"], allsents = best
    stat.update(spans=spans, rate=rate, words=len(words), cost=cost)
    stat["text"] = sum(1 for a, b in spans if b > a)
    used = [(l["end"] - l["start"], b - a) for l, (a, b) in zip(lines, spans) if b > a]
    if used:
        stat["wps"] = sum(w for _, w in used) / sum(d for d, _ in used)
    stat["out"] = sentence_lines(lines, spans, words, allsents)
    return stat


# ---------- 按句重切、标 kind ----------

# 指导语：只认这些固定说法（各年卷面一样；录音开头的标题也算）。认不出的一律当原文，不猜
_W = r"\s*"
_WHAT = r"(?:news\s*reports?|conversations?|passages?|recordings?|talks?|lectures?)"
DIRECTION_RES = [re.compile(p, re.I) for p in (
    r"^College\s*English\s*Test\b.*$",
    r"^Part\s*(?:II|2|Two)\b\.?\s*(?:Listening\s*Comprehension\.?)?$",
    r"^Listening\s*Comprehension\.?$",
    r"^Section\s*[ABC]\b\.?(?:\s*Directions\s*:?)?$",
    r"^Directions\s*:?$",
    r"^In\s*this\s*part\b.*$",
    r"^There\s*are\s*three\s*sections\b.*$",
    r"^You\s*(?:'ll|’ll|\s+will)\s*hear\s*(?:two|three)\s*(?:long\s*conversations|news\s*reports|passages|lectures|talks|recordings)\b.*$",
    r"^(?:and\s+|or\s+)?(?:two|three)?\s*(?:passages|lectures|talks|recordings)\s*in\s*section\s*[ABC]\b.*$",
    r"^(?:Section\s*[ABC]\b\.?\s*)?(?:Directions\s*:\s*)?In\s*this\s*section,?\s*you\s*will\s*hear\b.*$",
    r"^At\s*the\s*end\s*of\s*(?:each|the)\s*" + _WHAT + r"\s*,?\s*(?:you\s*will\s*hear\b.*\bquestions?|one\s*or\s*more\s*questions\s*will\s*be\s*asked\b.*|passage\b.*\bquestions?)\.?$",
    r"^(?:Both|All)\s*the\s*(?:listening\s*materials|" + _WHAT + r")\s*and\s*(?:the\s*)?questions\s*will\s*be\s*(?:spoken|read|played)\s*only\s*once\.?$",
    r"^The\s*" + _WHAT + r"\s*(?:and\s*the\s*questions\s*)?will\s*be\s*(?:spoken|read|played)\s*only\s*once\.?$",
    r"^(?:After\s*you\s*hear\s*a\s*question\s*,?\s*)?you\s*must\s*choose\s*the\s*best\s*answer\s*from\s*the\s*four\s*choices\b.*$",
    r"^(?:marked\s+)?(?:A\b.*)?(?:B,?\s*)?(?:C,?\s*)?(?:and\s+)?D[).,;\s]+then\s*mark\s*the\b.*$",
    r"^After\s*each\s*question\s*there\s*will\s*be\s*a\s*pause\.?$",
    r"^During\s*the\s*pause\s*,?\s*you\s*must\s*read\s*the\s*four\s*choices\b.*\bbest\s*answer\.?$",
    r"^Then,?\s*mark\s*the\s*(?:a\s+)?corresponding\s*letter\s*on\s*Answer\s*Sheet\s*(?:1|One|I)\b.*\bthrough\s*the\s*cent(?:re|er)\.?$",
    r"^(?:News\s*Report|Conversation|Passage|Recording|Lecture|Talk)\s*(?:One|Two|Three|Four|Five|[1-5])\.?$",
)]
CUE_RE = re.compile(r"^Questions?\s*\d{1,2}\s*(?:and|to|-)\s*\d{1,2}\s*(?:are\s*)?based\s*on", re.I)
QUESTION_RE = re.compile(r"^Question\s*\d{1,2}\b")
END_TOK = re.compile(r"([.?!]+)([\"')]*)$")
# 题干里疑问词和助动词粘在一起（Whydid、Whatdoes）：拆词那一步把首字母大写的生词当人名，没拆
WH_GLUE = re.compile(r"\b(What|Why|How|Which|Where|When|Who|Whom|Whose)(?=(?:do|does|did|is|are|was|were|will|would|can|could|should|has|have|had|might|may|must)\b)")


def classify(text):
    """这一句是不是指导语 / 读题句 / 读题：返回 "directions" / "cue" / "question" / None（原文）"""
    t = re.sub(r"\s+", " ", norm(text)).strip()
    if QUESTION_RE.match(t):
        return "question"
    if CUE_RE.match(t):
        return "cue"
    if any(r.match(t) for r in DIRECTION_RES):
        return "directions"
    return None


def _ends_sentence(tok, nxt):
    """tok 后面是不是句子分界（和 split_sentences 一样：. ? ! 后面接大写或数字；Mr. U.S. p.m. J. 不算，No. 36 不算）"""
    m = END_TOK.search(tok)
    if not m or not re.match(r"[\"'(]?[A-Z0-9]", nxt):
        return False
    if m.group(1) == ".":
        prev = re.search(r"([A-Za-z.]+)$", tok[: m.start()])
        orig = prev.group(1) if prev else ""
        if orig.strip(".").lower() in ABBR or (len(orig.strip(".")) == 1 and orig[:1].isupper()):
            return False
        if nxt[:1].isdigit():
            return False
    return True


_FUNCTION = set("the a an of in on at to for with by from into about and or but nor as than that which who whom whose this these those his her their its our my your called named like said says".split())
# 丢了句号时，下一句常见的开头词（只认这些；人名、地名、机构名开头的认不出，宁可不切）
_STARTERS = set("The A An This That These Those It He She They We You There But And So Yet However Now Then Still Also Instead Meanwhile "
                "Today Some Many Most Others Such What Why How When Where If While Although Though Because Since After Before "
                "Our His Her Their Its My Your Every Each Both".split())


def _cue_starts(toks, k):
    """toks[k] 起是不是读题句 "Questions 1 and 2 are based on…"（原文识别时把它粘在了上一句后面）"""
    return toks[k] in ("Questions", "Question") and bool(CUE_RE.match(" ".join(toks[k : k + 8])))


def _lost_period(prev, nxt):
    """原文丢了句号（"…in the world So we…"）：只在录音的停顿处（调用方保证）、前一个词小写、没有标点、不是虚词，
    后一个词是常见的句首词时，当成句子分界"""
    if not re.fullmatch(r"[a-z][A-Za-z0-9'-]*[a-z0-9]", prev) or prev.lower() in _FUNCTION:
        return False
    return nxt in _STARTERS


def _emit(units):
    """units: [{toks, start, end, spk}] → lines。读题 "Question N." 和后面的题干并成一行；
    句末孤零零一个 M / W（识别把下一句的说话人标记留在了这一句末尾）去掉"""
    def is_q(u):
        return bool(QUESTION_RE.match(" ".join(u["toks"][:2])))

    merged = []
    for u in units:
        if merged and is_q(merged[-1]) and not u["spk"] and classify(" ".join(u["toks"])) is None:
            merged[-1]["toks"] += u["toks"]
            merged[-1]["end"] = u["end"]
            continue
        merged.append({**u, "toks": list(u["toks"])})
    out = []
    for k, u in enumerate(merged):
        toks = u["toks"]
        nxt = merged[k + 1]["spk"] if k + 1 < len(merged) else None
        if len(toks) > 1 and toks[-1] in ("M", "W") and nxt == toks[-1] and u["spk"] != nxt:
            toks = toks[:-1]
        if len(toks) > 1 and toks[-1] == '"' and " ".join(toks).count('"') % 2:
            toks = toks[:-1]  # 引号落单（原文识别把下一句前面的引号留在了这里）
        text = re.sub(r"\s+", " ", " ".join(toks)).strip()
        if not re.search(r"[A-Za-z0-9]", text):
            continue
        kind = classify(text)
        if kind == "question":
            text = WH_GLUE.sub(r"\1 ", text)
        line = {"start": round(u["start"], 2), "end": round(max(u["end"], u["start"] + 0.05), 2), "text": text}
        if u["spk"] and not kind:
            line["speaker"] = u["spk"]
        if kind:
            line["kind"] = kind
        out.append(line)
    return out


def sentence_lines(lines, spans, words, sents):
    """对齐结果 → 一句一行。一句跨几个碎片的，取第一个的 start、最后一个的 end；碎片里有句子分界的，按字符数比例切时间。
    读题和题干按题号并成一行"""
    times = [None] * len(words)
    for l, (a, b) in zip(lines, spans):
        if b <= a:
            continue
        tot = sum(words[j]["len"] for j in range(a, b))
        dur = l["end"] - l["start"]
        acc = 0
        for j in range(a, b):
            s = l["start"] + dur * acc / tot
            acc += words[j]["len"]
            times[j] = (s, l["start"] + dur * acc / tot)
    line_of = [None] * len(words)
    for i, (a, b) in enumerate(spans):
        for j in range(a, b):
            line_of[j] = i
    units, key = [], None
    for j, w in enumerate(words):
        if times[j] is None:
            continue
        s = sents[w["si"]]
        k = ("q", s["n"]) if s.get("role") in ("qnum", "stem") else ("s", w["si"])
        # 同一句里也要切开的地方：原文丢了句号（录音在这里停顿）；读题句被识别进了原文末尾（"…looked after. " Questions 3 and 4 are based on…"）
        cut = k == key and s.get("role") == "story" and (
            (line_of[j] != line_of[j - 1] and _lost_period(words[j - 1]["t"], w["t"])) or _cue_starts([x["t"] for x in words[j : j + 8]], 0)
        )
        if k != key or cut:
            units.append({"toks": [], "start": times[j][0], "end": times[j][1], "spk": w["spk"]})
            key = k
        units[-1]["toks"].append(w["t"])
        units[-1]["end"] = times[j][1]
    return _emit(units)


def recut_text(lines):
    """没对齐的行（样卷合成的录音、对不上的段、已经按句切过的行）按文字重切：一行里有几句的按字符数比例切开；
    一行没说完（末尾不是 . ? !）、下一行同一个人、小写开头的接上；没有文字的行去掉。对已经切好的行不改（可以反复跑）"""
    units, open_ = [], False
    for l in lines:
        toks = (l.get("text") or "").split()
        if not toks:
            continue
        spk = l.get("speaker")
        tot = sum(len(t) + 1 for t in toks)
        dur = l["end"] - l["start"]
        acc = 0
        join = open_ and units and units[-1]["spk"] == spk and toks[0][:1].islower() and classify(" ".join(toks)) is None
        if not join:
            units.append({"toks": [], "start": l["start"], "end": l["start"], "spk": spk})
        for k, t in enumerate(toks):
            s = l["start"] + dur * acc / tot
            acc += len(t) + 1
            e = l["start"] + dur * acc / tot
            if not units[-1]["toks"]:
                units[-1]["start"] = s
            units[-1]["toks"].append(t)
            units[-1]["end"] = e
            if k + 1 < len(toks) and (_ends_sentence(t, toks[k + 1]) or _cue_starts(toks, k + 1)):
                units.append({"toks": [], "start": e, "end": e, "spk": spk})
        open_ = not END_TOK.search(toks[-1])
    return _emit([u for u in units if u["toks"]])


def kind_counts(lines):
    out = {"directions": 0, "cue": 0, "question": 0}
    for l in lines:
        if l.get("kind") in out:
            out[l["kind"]] += 1
    return out


def is_cut(paper):
    """lines 已经按句切过了（有 kind）"""
    return any("kind" in l for s in paper["audio"]["segments"] for l in s.get("lines", []))


def _raw_file(pid):
    return RAW_CACHE / f"{pid}.json"


def save_raw(paper):
    """按停顿切的原始行存起来（按句重切以后试卷里就没有了，重新对齐要用）"""
    RAW_CACHE.mkdir(parents=True, exist_ok=True)
    segs = [{"id": s["id"], "start": s["start"], "end": s["end"], "lines": s["lines"]} for s in paper["audio"]["segments"]]
    _raw_file(paper["id"]).write_text(json.dumps({"id": paper["id"], "segments": segs}, ensure_ascii=False, separators=(",", ":")), "utf-8")


def load_raw(paper):
    """缓存里的原始行：{段 id: lines}；段的 id、起止和试卷对不上（重新导入过、改过分段）就当没有"""
    p = _raw_file(paper["id"])
    if not p.exists():
        return None
    try:
        segs = json.loads(p.read_text("utf-8"))["segments"]
    except (ValueError, KeyError):
        return None
    if [(s["id"], s["start"], s["end"]) for s in segs] != [(s["id"], s["start"], s["end"]) for s in paper["audio"]["segments"]]:
        return None
    return {s["id"]: s["lines"] for s in segs}


def retag_paper(paper):
    """不对齐，只按文字重切、标 kind（样卷、没有原始行的已切卷子）。返回报告"""
    rep = {"id": paper["id"], "segments": [], "ok": True, "note": ""}
    for seg in paper["audio"]["segments"]:
        n = len(seg["lines"])
        seg["lines"] = recut_text(seg["lines"])
        rep["segments"].append({"id": seg["id"], "lines": n, "text": n, "wps": 0.0, "rate": 0.0, "quality": 0.0, "warn": [], "words": 0, "sents": len(seg["lines"]), "kinds": kind_counts(seg["lines"])})
    return rep


# ---------- 一套卷子 ----------

def listening_groups(paper):
    """卷子里的听力题组：[{lo, hi, kind, seg}]，按卷面顺序"""
    out = []
    for sec in paper["sections"]:
        if sec["kind"] != "listening":
            continue
        for g in sec["groups"]:
            nums = [q["number"] for q in g["questions"]]
            if nums:
                out.append({"lo": min(nums), "hi": max(nums), "kind": re.sub(r"\d+$", "", g["id"]), "seg": g.get("audioSegment"), "id": g["id"]})
    return out


def answers_pdf_of(pid):
    import import_cet

    info = import_cet.discover().get(pid)
    return info.get("answers") if info else None


def align_paper(paper, answers_pdf, allow_ocr=True, src=None, workers=8, log=None):
    """给 paper（dict，会就地改 audio.segments[].lines[].text）对逐字稿。返回报告 dict：
      {"id", "segments": [{id, lines, text, wps, rate, quality, warn[]}], "ok": bool, "note": str}"""
    pid = paper["id"]
    rep = {"id": pid, "segments": [], "ok": False, "note": ""}
    audio = paper.get("audio")
    if not audio:
        rep["note"] = "没有录音"
        return rep
    groups = listening_groups(paper)
    if not groups or any(not g["seg"] for g in groups):
        rep["note"] = "题组没有对应的录音分段"
        return rep
    segs = {s["id"]: s for s in audio["segments"]}
    if any(g["seg"] not in segs for g in groups):
        rep["note"] = "题组引用的录音分段不存在"
        return rep
    # 对齐要用按停顿切的原始行：试卷里的行还没按句切过就是原始行（存一份）；切过了就从缓存取，取不到只能按文字重标
    before = [None] * len(audio["segments"])
    if is_cut(paper):
        raw = load_raw(paper)
        if raw is None:
            rep = retag_paper(paper)
            rep["note"] = f"没有按停顿切的原始行（{RAW_CACHE.relative_to(ROOT).as_posix()}/），只按句重标了 kind；要重新对齐请重新导入"
            return rep
        before = [s["lines"] for s in audio["segments"]]
        for s in audio["segments"]:
            s["lines"] = copy.deepcopy(raw[s["id"]])
    else:
        save_raw(paper)
    if src is None:
        pages = script_pages(answers_pdf, paper["exam"], groups)
        if not pages:
            # 对不了：切过的放回去，原始行按文字切（去掉空行）
            for s, old in zip(audio["segments"], before):
                s["lines"] = old if old is not None else recut_text(s["lines"])
            rep["note"] = "解析里没定位到听力原文所在的页"
            return rep
        # "录音分析"版式（见 boxed_block）：每个题组的分析要占三四页，最后一组的原文在最后一个标题后面好几页
        fp = FirstPass(answers_pdf)
        boxed = any(BOX_HEAD.search(t) or SCRIPT_HEAD.search(t) for t in (" ".join(l["text"] for l in (fp.lines(i) or [])) for i in pages))
        if boxed:
            pages = list(range(pages[0], min(fp.n, pages[-1] + 4)))
        if allow_ocr:
            # 听力原文那几页还没高清识别的，多进程一起识别（缓存）
            doc = fitz.open(answers_pdf)
            todo = [(str(answers_pdf), i) for i in pages if not text_usable(cet_ocr.text_lines(doc[i]))]
            prefetch(todo, workers=workers, log=log or (lambda m: None))
        src = PageSource(answers_pdf, allow_ocr=allow_ocr, pages=pages)
        if boxed:
            src.tail_pages = 3
        first = pages[0]
    else:
        first = 0
    items = extract_group_scripts(src, paper["exam"], groups, first)
    src.save()
    kinds_ok = [(g["lo"], g["hi"]) for g in groups] == [(a, b) for a, b, _ in TEMPLATES[paper["exam"]]]  # 版式对得上才加指导语
    dir_by_sid = {
        "cet4": {"news1": DIRECTIONS["cet4"][0], "conv1": DIRECTIONS["cet4"][3], "pass1": DIRECTIONS["cet4"][5]},
        "cet6": {"conv1": DIRECTIONS["cet6"][0], "pass1": DIRECTIONS["cet6"][2], "rec1": DIRECTIONS["cet6"][4]},
    }.get(paper["exam"], {})
    for gi, (g, item) in enumerate(zip(groups, items)):
        seg = segs[g["seg"]]
        r = {"id": seg["id"], "lines": len(seg["lines"]), "text": 0, "wps": 0.0, "rate": 0.0, "quality": item["quality"], "warn": list(item["warn"]), "words": 0}
        out = None
        if item["story"]:
            pre = dir_by_sid.get(seg["id"]) or (DIRECTIONS.get(paper["exam"], {}).get(gi) if kinds_ok else None)
            st = align_segment(seg, item, pre, free_lead=(gi == 0))
            r.update(text=st["text"], wps=st["wps"], rate=st["rate"], words=st["words"], pre=st["pre"])
            out = st["out"]
            if st["spans"] is None:
                r["warn"].append("动态规划无解")
        # 一句一行；没对上的段（只有导入时标的 Question N）按文字切
        seg["lines"] = out if out is not None else recut_text(seg["lines"])
        r["sents"] = len(seg["lines"])
        r["kinds"] = kind_counts(seg["lines"])
        rep["segments"].append(r)
    # 不属于任何题组的段（一般没有）也按句切
    used = {g["seg"] for g in groups}
    for s in audio["segments"]:
        if s["id"] not in used:
            s["lines"] = recut_text(s["lines"])
    rep["ok"] = all(s["text"] for s in rep["segments"])
    return rep


def ocr_for(papers, workers=12, log=print):
    """给这些试卷的解析 PDF 里听力原文那几页做高清识别（多进程，结果缓存）"""
    jobs = []
    for paper in papers:
        pdf = answers_pdf_of(paper["id"])
        groups = listening_groups(paper)
        if not pdf or not groups:
            continue
        pages = script_pages(pdf, paper["exam"], groups)
        if not pages:
            log(f"{paper['id']}  没定位到听力原文所在的页（先识别解析里的扫描页：import_cet.py 不带 --no-ocr）")
        jobs += [(str(pdf), i) for i in pages]
    # 文字层能用的页不用识别
    todo = []
    for pdf, i in jobs:
        page = fitz.open(pdf)[i]
        if not text_usable(cet_ocr.text_lines(page)):
            todo.append((pdf, i))
    prefetch(todo, workers=workers, log=log)


def paper_files():
    """有录音的卷子（真题和样卷；样卷没有解析 PDF，只按句重切、标 kind）"""
    return sorted(PAPERS.glob("cet*.json"))


def fmt_report(rep):
    out = [f"{rep['id']}  {rep['note']}"]
    for s in rep["segments"]:
        pct = 100 * s["text"] / s["lines"] if s["lines"] else 0
        flag = ""
        if s["wps"] and not 2.0 <= s["wps"] <= 3.5:
            flag += "  语速异常"
        if s["quality"] and s["quality"] < 0.93:
            flag += "  文字质量低"
        sents = f" → {s['sents']:3} 句" if "sents" in s else ""
        out.append(f"   {s['id']:6} 行 {s['lines']:3} 有字 {s['text']:3} ({pct:3.0f}%){sents} 词/秒 {s['wps']:.2f} 字符/秒 {s['rate']:.1f} 原文质量 {s['quality']:.2f}{flag}" + ("  " + "；".join(s["warn"]) if s["warn"] else ""))
    return "\n".join(out)


def show(paper):
    for seg in paper["audio"]["segments"]:
        print(f"== {seg['id']} {seg['label']}")
        for i, l in enumerate(seg["lines"]):
            d = l["end"] - l["start"]
            n = len(l.get("text", "").split())
            print(f"{i:3d} {l['start']:8.2f} {d:5.2f}s {n/d if d else 0:4.1f}w/s {l.get('kind', '')[:3]:3} {l.get('speaker', ' ')} {l.get('text', '')}")


def line_counts(paper):
    """全卷的行数和各 kind 的行数"""
    lines = [l for s in paper["audio"]["segments"] for l in s["lines"]]
    return len(lines), kind_counts(lines)


# ---------- 解析层：听力题的定位句 → 逐字稿句号 ----------

def _match_words(text):
    """比较用的词：小写、去撇号，只比前 7 个字母（识别错字多在词尾）"""
    return [w[:7] for w in re.findall(r"[a-z0-9]+", norm(text).lower().replace("'", ""))]


def _coverage(a, b):
    """a 里的元素有多少在 b 里（按个数）"""
    from collections import Counter

    ca, cb = Counter(a), Counter(b)
    hit = sum(min(n, cb[k]) for k, n in ca.items())
    return hit, hit / max(1, sum(ca.values()))


def best_line(quote, segments, seg_id):
    """quote 最像逐字稿里的哪一句（只看原文句，不看指导语和读题）：返回 ({segment, index}, 分数)，太不像返回 (None, 分数)。
    分数 = quote 的相邻词对有多少出现在这一句里（为主）+ 单词覆盖（为辅）；quote 跨两句时取覆盖多的那句"""
    q = _match_words(quote)
    if not q:
        return None, 0.0
    pool = [s for s in segments if s["id"] == seg_id] or segments
    best, best_sc = None, 0.0
    for s in pool:
        for i, l in enumerate(s["lines"]):
            if l.get("kind"):
                continue
            w = _match_words(l.get("text", ""))
            n1, uni = _coverage(q, w)
            n2, bi = _coverage(list(zip(q, q[1:])), list(zip(w, w[1:]))) if len(q) > 1 else (n1, uni)
            sc = 0.7 * bi + 0.3 * uni
            if n2 >= 2 or (len(q) <= 3 and uni >= 0.99):
                if sc > best_sc + 1e-9:
                    best, best_sc = {"segment": s["id"], "index": i}, sc
    return (best, best_sc) if best_sc >= 0.3 else (None, best_sc)


def relink_explain(ids=None, min_age=120, log=print):
    """解析层里听力题的 fields.locate.quote → fields.locate.line = {segment, index}（逐字稿第几句）。
    只改 line 这一个字段：解析层可能有别的脚本同时在写，所以最近 min_age 秒内改过的文件跳过，写之前重新读一遍"""
    files = [EXPLAIN / f"{i}.json" for i in ids] if ids else sorted(EXPLAIN.glob("*.json"))
    tot = {"files": 0, "linked": 0, "unmatched": 0, "skipped": 0}
    for ep in files:
        pid = ep.stem
        pp = PAPERS / f"{pid}.json"
        if not ep.exists() or not pp.exists():
            continue
        paper = json.loads(pp.read_text("utf-8"))
        audio = paper.get("audio")
        if not audio:
            continue
        qseg = {q["id"]: g.get("audioSegment") for s in paper["sections"] if s["kind"] == "listening" for g in s["groups"] for q in g["questions"]}
        if time.time() - ep.stat().st_mtime < min_age:
            log(f"{pid}  解析层 {int(time.time() - ep.stat().st_mtime)} 秒前刚改过，跳过")
            tot["skipped"] += 1
            continue
        raw = ep.read_bytes()  # 写之前现读
        layer = json.loads(raw.decode("utf-8"))
        linked = unmatched = changed = 0
        for qid, ent in (layer.get("questions") or {}).items():
            loc = (ent.get("fields") or {}).get("locate") if isinstance(ent, dict) else None
            if qid not in qseg or not isinstance(loc, dict) or not loc.get("quote"):
                continue
            hit, _ = best_line(loc["quote"], audio["segments"], qseg[qid])
            if hit:
                linked += 1
                if loc.get("line") != hit:
                    loc["line"] = hit
                    changed += 1
            else:
                unmatched += 1
                if "line" in loc:
                    del loc["line"]
                    changed += 1
        if changed:
            if time.time() - ep.stat().st_mtime < min_age or ep.read_bytes() != raw:
                log(f"{pid}  解析层在比对时被改了，跳过")
                tot["skipped"] += 1
                continue
            nl = "\r\n" if b"\r\n" in raw else "\n"
            tmp = ep.with_suffix(".json.tmp")
            with io.open(tmp, "w", encoding="utf-8", newline=nl) as f:
                json.dump(layer, f, ensure_ascii=False, indent=1)
            os.replace(tmp, ep)
        if linked or unmatched:
            tot["files"] += 1
            log(f"{pid}  定位到句 {linked}，没找到 {unmatched}" + (f"（改了 {changed} 条）" if changed else ""))
        tot["linked"] += linked
        tot["unmatched"] += unmatched
    log(f"\n解析层：{tot['files']} 套有听力定位句，定位到 {tot['linked']} 条，没找到 {tot['unmatched']} 条；跳过 {tot['skipped']} 套（正在被改）")


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    fitz.TOOLS.mupdf_display_errors(False)
    ap = argparse.ArgumentParser(description="听力逐字稿对齐")
    ap.add_argument("ids", nargs="*", help="试卷 id；不写就是全部有录音的卷子")
    ap.add_argument("--report", action="store_true", help="只打印报告，不写文件")
    ap.add_argument("--show", action="store_true", help="打印对齐后的每一句（带时长和 kind）")
    ap.add_argument("--no-ocr", action="store_true", help="不做高清识别（缓存里没有的页就算了）")
    ap.add_argument("--ocr-only", action="store_true", help="只做高清识别（多进程，先跑这个再对齐会快很多）")
    ap.add_argument("--workers", type=int, default=12, help="高清识别的进程数")
    ap.add_argument("--relink-explain", action="store_true", help="只给解析层里听力题的 fields.locate 补 line（逐字稿句号），不对齐")
    args = ap.parse_args()
    if args.relink_explain:
        relink_explain(args.ids or None, log=lambda m: print(m, flush=True))
        return
    files = [PAPERS / f"{i}.json" for i in args.ids] if args.ids else paper_files()
    if args.ocr_only or not args.no_ocr:
        papers = [json.loads(f.read_text("utf-8")) for f in files]
        ocr_for([p for p in papers if p.get("audio")], workers=args.workers, log=lambda m: print(m, flush=True))
        if args.ocr_only:
            return
    reports, before_all, after_all, kinds_all = [], 0, 0, {"directions": 0, "cue": 0, "question": 0}
    for f in files:
        paper = json.loads(f.read_text("utf-8"))
        if not paper.get("audio"):
            continue
        lend = next((s["from"] for s in paper["sections"] if s["kind"] == "listening" and s.get("from")), None)
        if lend:
            # 听力是从同场另一套接过来的（scripts/share_listening.py）：对齐那一套，再重跑 share_listening.py
            print(f"{paper['id']}  听力接自 {lend}，跳过", flush=True)
            continue
        before, _ = line_counts(paper)
        pdf = answers_pdf_of(paper["id"])
        try:
            if pdf:
                rep = align_paper(paper, pdf, allow_ocr=not args.no_ocr)
            else:
                rep = retag_paper(paper)
                rep["note"] = "没有解析 PDF（样卷）：不对齐，只按句重切、标 kind"
        except Exception as e:
            import traceback

            traceback.print_exc()
            print(f"{paper['id']}  出错：{type(e).__name__}: {e}")
            continue
        reports.append(rep)
        after, kinds = line_counts(paper)
        before_all += before
        after_all += after
        for k in kinds_all:
            kinds_all[k] += kinds[k]
        print(fmt_report(rep), flush=True)
        print(f"   逐句：{before} 行 → {after} 句（指导语 {kinds['directions']}、读题句 {kinds['cue']}、读题 {kinds['question']}）", flush=True)
        if args.show:
            show(paper)
        if not args.report:
            f.write_text(json.dumps(paper, ensure_ascii=False, indent=2) + "\n", "utf-8")
    if len(reports) > 1:
        tot = sum(s["lines"] for r in reports for s in r["segments"])
        txt = sum(s["text"] for r in reports for s in r["segments"])
        print(f"\n共 {len(reports)} 套，按停顿切的 {tot} 行里有字 {txt} 行（{100 * txt / max(tot, 1):.1f}%）")
        print(f"逐句：{before_all} 行 → {after_all} 句（指导语 {kinds_all['directions']}、读题句 {kinds_all['cue']}、读题 {kinds_all['question']}）")


if __name__ == "__main__":
    main()
