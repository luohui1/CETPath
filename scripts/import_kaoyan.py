"""把考研英语（一）真题 PDF 和答案解析 PDF 转成"数字原卷"的结构化试卷。

来源：GitHub m2kar/KaoYan-English 转载的真题 PDF（文字版），放在 data/raw/kaoyan/：
  kaoyan1-<年份>.pdf          真题
  kaoyan1-<年份>-answers.pdf  答案详解
输出：
  public/papers/kaoyan1-<年份>.json   试卷（没有 pdf 字段，考场按数字原卷排版）
  public/papers/img/…                  作文配图
用法：python -I scripts/import_kaoyan.py 2019
"""
import json
import re
import sys
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data/raw/kaoyan"

# 转载版本里明显的录入错误，按官方试卷修正：(在哪里, 错误写法, 正确写法)
CORRECTIONS = {
    2019: [
        ("s1", "you should able to", "you should be able to"),
        ("q15", "form", "from"),
        ("q24", "examples and used to illustrate", "examples are used to illustrate"),
        ("t2", "“Untimely,” said", "“Ultimately,” said"),
        ("t2", "subsequent contents", "subsequent courses"),
        ("t3", "“West world”", "“Westworld”"),
        ("t4", "limited state’ ability", "limited States’ ability"),
        ("q36", "business’ revolutions with states", "business’ relations with states"),
        ("q37", "criticized by online purchases", "criticized by online purchasers"),
        ("q37", "were consider unfavorable", "were considered unfavorable"),
        ("q39", "Big-chair owners", "Big-chain owners"),
        ("q40", "cities some cases", "cites some cases"),
        ("pc", "just how bad of the medical literature", "just how bad much of the medical literature"),
        ("q51", "ANSEWER SHEET", "ANSWER SHEET."),
        ("q51", "“Aiding rural Primary School”", "“Aiding Rural Primary Schools”"),
    ],
}

CJK = re.compile(r"[　-〿一-鿿＀-￯]")
NOISE = re.compile(r"^(\d{1,2}|淘宝店铺.*|掌柜旺旺.*)$")


def join_lines(lines):
    """把折行拼回来：中文之间不加空格，英文之间加空格"""
    out = ""
    for ln in lines:
        ln = ln.strip()
        if not ln:
            continue
        if out and not (CJK.match(out[-1]) or CJK.match(ln[0]) or out.endswith(("—", "-", "“", "("))):
            out += " "
        out += ln
    return re.sub(r"\s+", " ", out).strip()


def page_lines(pdf):
    """逐行取出文字，带上行首 x 坐标（用来认段落缩进），去掉页码和页脚"""
    rows = []
    for page in fitz.open(pdf):
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                text = "".join(s["text"] for s in line["spans"]).strip()
                if text and not NOISE.match(text):
                    rows.append((round(line["bbox"][0]), text))
    return rows


def paragraphs(rows, left):
    """缩进的行（x 明显大于左边距）开始一个新段落"""
    paras, cur = [], []
    for x, text in rows:
        if cur and x > left + 8:
            paras.append(join_lines(cur))
            cur = []
        cur.append(text)
    if cur:
        paras.append(join_lines(cur))
    return paras


def tidy(text):
    """补上原文里标点后缺的空格：{{13}},even -> {{13}}, even；“Yes,”and -> “Yes,” and"""
    text = re.sub(r"([,;:])(?=[A-Za-z“{])", r"\1 ", text)
    text = re.sub(r"(”)(?=[A-Za-z])", r"\1 ", text)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    return re.sub(r"\s{2,}", " ", text).strip()


def blanks(text):
    """___1___ / __2__ -> {{1}} {{2}}，前后补空格"""
    return tidy(re.sub(r"\s*_+\s*(\d+)\s*_+\s*", r" {{\1}} ", text))


def parse_options(rows):
    """[A] xxx 开头的行是选项，选项文字可能折行"""
    opts = []
    for _, text in rows:
        m = re.match(r"^\[([A-G])\]\s*(.*)$", text)
        if m:
            opts.append({"key": m.group(1), "text": m.group(2).strip()})
        elif opts:
            opts[-1]["text"] = join_lines([opts[-1]["text"], text])
    return opts


def split_at(rows, pred):
    """按满足 pred 的行切段：返回 [(标题行, 内容行)]"""
    parts = []
    for row in rows:
        if pred(row[1]):
            parts.append((row[1], []))
        elif parts:
            parts[-1][1].append(row)
    return parts


def directions_and_rest(rows):
    """Directions: 之后到 "(N points)" 为止是说明，后面是正文"""
    i = next(k for k, (_, t) in enumerate(rows) if t.startswith("Directions"))
    j = next(k for k in range(i, len(rows)) if re.search(r"points\s*\)\s*$", rows[k][1]))
    lines = [rows[i][1].split(":", 1)[-1].split("：", 1)[-1]] + [t for _, t in rows[i + 1 : j + 1]]
    return join_lines(lines), rows[j + 1 :]


def parse_paper(pdf):
    rows = page_lines(pdf)
    left = min(x for x, _ in rows)
    idx = lambda pred, start=0: next(k for k in range(start, len(rows)) if pred(rows[k][1]))
    s2 = idx(lambda t: t.startswith("Section II"))
    s3 = idx(lambda t: t.startswith("Section III"))
    pb = idx(lambda t: t == "Part B", s2)
    pc = idx(lambda t: t == "Part C", s2)
    w52 = idx(lambda t: t == "Part B", s3)

    # Section I 完形：说明、文章、20 道选项
    sec1 = rows[idx(lambda t: t.startswith("Directions")) : s2]
    d1, rest = directions_and_rest(sec1)
    q_start = next(k for k, (_, t) in enumerate(rest) if re.match(r"^1\.\s*\[A\]", t))
    cloze_text = [blanks(p) for p in paragraphs(rest[:q_start], left)]
    cloze_q = []
    for head, body in split_at(rest[q_start:], lambda t: re.match(r"^\d+\.\s*\[A\]", t)):
        num = int(re.match(r"^(\d+)\.", head).group(1))
        opts = parse_options([(0, re.sub(r"^\d+\.\s*", "", head))] + body)
        cloze_q.append({"id": f"q{num}", "number": num, "options": opts})

    # Section II Part A：四篇文章，每篇 5 题
    part_a = rows[s2:pb]
    da, rest = directions_and_rest(part_a)
    texts = []
    for head, body in split_at(rest, lambda t: re.match(r"^Text \d$", t)):
        q_at = next(k for k, (_, t) in enumerate(body) if re.match(r"^\d{2}\.\s*\S", t))
        qs = []
        for qh, qb in split_at(body[q_at:], lambda t: re.match(r"^\d{2}\.\s*\S", t)):
            num = int(re.match(r"^(\d{2})\.", qh).group(1))
            # 题干是选项之前的行
            first_opt = next(k for k, (_, t) in enumerate(qb) if t.startswith("["))
            stem = join_lines([re.sub(r"^\d{2}\.\s*", "", qh)] + [t for _, t in qb[:first_opt]])
            qs.append({"id": f"q{num}", "number": num, "stem": stem, "options": parse_options(qb[first_opt:])})
        texts.append({"title": head, "paragraphs": [tidy(x) for x in paragraphs(body[:q_at], left)], "questions": qs})

    # Part B：段落排序，A–G 七段，序列行 "41. →42.→F→43. →44.→C→45."
    part_b = rows[pb:pc]
    db_, rest = directions_and_rest(part_b)
    seq_i = next(k for k, (_, t) in enumerate(rest) if "→" in t)
    blocks = []
    for _, text in rest[:seq_i]:
        m = re.match(r"^([A-G])\.\s*(.*)$", text)
        if m:
            blocks.append([m.group(1), [m.group(2)]])
        else:
            blocks[-1][1].append(text)
    order_paras = [{"key": k, "text": tidy(join_lines(v))} for k, v in blocks]
    sequence = [s.strip(" .") for s in rest[seq_i][1].split("→")]

    # Part C：翻译，正文里 46)–50) 开头的是划线句；第 8 页末尾又把划线句列了一遍，用来确定划线范围
    part_c = rows[pc:s3]
    dc, rest = directions_and_rest(part_c)
    list_at = next(k for k in range(len(rest)) if re.match(r"^46\)", rest[k][1]) and k > 5 and any(re.match(r"^47\)", t) for _, t in rest[k + 1 : k + 4]))
    segs = {}
    for head, body in split_at(rest[list_at:], lambda t: re.match(r"^4[6-9]\)|^50\)", t)):
        n = int(head[:2])
        segs[n] = join_lines([head[3:]] + [t for _, t in body])
    c_paras = [tidy(x) for x in paragraphs(rest[:list_at], left)]
    for n, seg in segs.items():
        tail = seg[-12:]
        for i, p in enumerate(c_paras):
            start = p.find(f"{n}) ")
            if start < 0:
                continue
            end = p.find(tail, start)
            end = end + len(tail) if end >= 0 else len(p)
            body = p[start + len(f"{n}) ") : end]
            c_paras[i] = p[:start] + f"[[{n}|{body}]]" + p[end:]

    # Section III 写作：51、52 两题
    def writing(block_rows):
        """写作要求：1)、2)、3) 要点和 "You should…""Do not…" 这样的要求各占一行"""
        i = next(k for k, (_, t) in enumerate(block_rows) if "Directions" in t)
        text = join_lines([t for _, t in block_rows[i + 1 :]])
        return re.sub(r"\s+(?=\d\)\s|You should |Do not )", "\n", text)

    w51_text = writing(rows[s3:w52])
    w52_text = writing(rows[w52:])

    return {
        "cloze": {"directions": d1, "paragraphs": cloze_text, "questions": cloze_q},
        "reading": {"directions": da, "texts": texts},
        "order": {"directions": db_, "paragraphs": order_paras, "sequence": sequence},
        "translation": {"directions": dc, "paragraphs": c_paras, "segments": segs},
        "writing": {"a": w51_text, "b": w52_text},
    }


def parse_answers(pdf):
    """答案详解：每题的答案、考点、解析；翻译的参考译文；写作的参考范文"""
    lines = [t for _, t in page_lines(pdf)]
    text = "\n".join(lines)
    ans = {}

    # 1–40：题号行之后的【答案】【考点】【解析】
    heads = [(m.start(), int(m.group(1))) for m in re.finditer(r"^(\d{1,2})\.\s*(?:\[A\]|\S)", text, re.M)]
    marks = [(m.start(), int(m.group(1))) for m in re.finditer(r"^(4[1-5])【答案】", text, re.M)]
    for pos, n in heads:
        if n > 40 or n in ans:
            continue
        chunk = text[pos : pos + 6000]
        m = re.search(r"【答案】\s*([A-G])", chunk)
        if not m:
            continue
        ans[n] = {"answer": m.group(1), "explanation": explain(chunk[m.end() :])}
    for pos, n in marks:
        chunk = text[pos : pos + 4000]
        m = re.search(r"【答案】\s*([A-G])", chunk)
        ans[n] = {"answer": m.group(1), "explanation": explain(chunk[m.end() :])}

    # 46–50 参考译文（有一处写成了【参看译文】）。只认行首、后面接英文的 "（46）"，
    # 全文翻译里也有 (47) 这样的标号，那些不是
    marks = [(m.start(), int(m.group(1))) for m in re.finditer(r"^[（(]\s*(4[6-9]|50)\s*[）)]\s*\n?\s*[A-Z]", text, re.M)]
    for k, (pos, n) in enumerate(marks):
        end = marks[k + 1][0] if k + 1 < len(marks) else len(text)
        block = text[pos:end]
        r = re.search(r"【参[考看]译文】(.*?)(?=\n【|\nSection|\Z)", block, re.S)
        c = re.search(r"【题目考点】(.*?)(?=\n【)", block, re.S)
        if r and n not in ans:
            ans[n] = {"reference": join_lines(r.group(1).split("\n"))}
            if c:
                ans[n]["explanation"] = "考点：" + join_lines(c.group(1).split("\n"))

    # 51、52 参考范文：保留分段（以缩进或称呼行为界很难判断，这里按句末换行近似）
    for n in (51, 52):
        m = re.search(rf"^{n}【参考范文】\n(.*?)(?=^\d{{2}}【参考范文】|\Z)", text, re.S | re.M)
        if m:
            ans[n] = {"reference": essay(m.group(1))}
    return ans


def explain(chunk):
    """【考点】+【解析】正文，截到下一题或下一个大标题"""
    stop = re.search(r"\n(?:\d{1,2}[\.．]\s*(?:\[A\]|\S)|\d{2}【答案】|四、|Text \d|Part [A-C]|Section|【知识补充】|【重点词汇】)", chunk)
    body = chunk[: stop.start()] if stop else chunk
    parts = []
    for tag, label in (("考点", "考点"), ("解析", "")):
        m = re.search(rf"【{tag}】(.*?)(?=\n【|\Z)", body, re.S)
        if m and m.group(1).strip():
            t = join_lines(m.group(1).split("\n"))
            parts.append(f"{label}：{t}" if label else t)
    return "\n".join(parts)


def essay(raw):
    """范文：称呼、落款单独成行，其余按句号结尾的行分段"""
    lines = [l.strip() for l in raw.split("\n") if l.strip()]
    paras, cur = [], []
    for l in lines:
        cur.append(l)
        if re.search(r"[.!?:”,]$", l) and (len(l) < 70 or l.endswith((".", "!", "?"))):
            # 行没写满（短行）通常是段落结尾
            if len(l) < 95:
                paras.append(join_lines(cur))
                cur = []
    if cur:
        paras.append(join_lines(cur))
    return "\n".join(paras)


def find_node(node, id_):
    """按 id 找到某个部分、题组或题目"""
    if isinstance(node, dict):
        if node.get("id") == id_:
            return node
        node = list(node.values())
    if isinstance(node, list):
        for v in node:
            r = find_node(v, id_)
            if r is not None:
                return r
    return None


def replace_once(node, pat, right):
    """在 node 里的字符串中替换第一处匹配，返回是否替换了"""
    items = node.items() if isinstance(node, dict) else enumerate(node) if isinstance(node, list) else []
    for k, v in items:
        if isinstance(v, str):
            new, n = pat.subn(right, v, count=1)
            if n:
                node[k] = new
                return True
        elif replace_once(v, pat, right):
            return True
    return False


TOKEN = re.compile(r"[A-Za-z][A-Za-z'’]*(?:-[A-Za-z]+)*")


def clean_pdf(src, dst):
    """去掉转载者加在页脚的淘宝店水印（整行盖掉），其余保持原样"""
    doc = fitz.open(src)
    for page in doc:
        hits = page.search_for("淘宝店铺") + page.search_for("掌柜旺旺")
        for r in hits:
            page.add_redact_annot(fitz.Rect(0, r.y0 - 3, page.rect.width, r.y1 + 3))
        if hits:
            page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)
    doc.save(dst, garbage=4, deflate=True, linear=True)
    return fitz.open(dst)


def page_words(page):
    """一页的可点击单词和句子：{w: [[词, x0, y0, x1, y1, 句子序号]], s: [句子]}。
    选项标记 [A] 不算单词；"10.[A]" 这类粘在一起的按字符比例切出单词框"""
    words, sentences, cur = [], [], []
    for x0, y0, x1, y1, text, *_ in page.get_text("words", sort=True):
        cur.append(text)
        masked = re.sub(r"\[[A-G]\]", lambda m: " " * len(m.group()), text)
        for m in TOKEN.finditer(masked):
            a = x0 + (x1 - x0) * m.start() / len(text)
            b = x0 + (x1 - x0) * m.end() / len(text)
            words.append([m.group(), round(a, 1), round(y0, 1), round(b, 1), round(y1, 1), len(sentences)])
        if re.search(r"[.?!][”\"’)]?$", text) and not re.fullmatch(r"\d+\.|Mr\.|Dr\.|U\.S\.", text):
            sentences.append(" ".join(cur))
            cur = []
    if cur:
        sentences.append(" ".join(cur))
    return {"width": round(page.rect.width, 1), "height": round(page.rect.height, 1), "w": words, "s": sentences}


def find_positions(doc):
    """原卷上的定位点 (页序号从 1 开始, [x0, y0, x1, y1])：
    题号（行首的 "21."、"10.[A]"，翻译的 "47)"，排序题序列里的 "42."），以及各部分标题"""
    pos, anchors = {}, {}
    section_keys = [("Section I", "s1"), ("Section II", "s2"), ("Part B", "s2b"), ("Part C", "s2c"), ("Section III", "s3")]
    r = lambda b: [round(v, 1) for v in b]
    for pi, page in enumerate(doc):
        words = page.get_text("words", sort=True)
        lines = {}
        for w in words:
            lines.setdefault((w[5], w[6]), []).append(w)
        for ws in lines.values():
            x0, y0, x1, y1, t = ws[0][:5]
            m = re.match(r"^(\d{1,2})[.)]", t)
            if m and 1 <= int(m.group(1)) <= 52 and int(m.group(1)) not in pos:
                cut = x0 + (x1 - x0) * len(m.group(0)) / len(t)
                pos[int(m.group(1))] = (pi + 1, r([x0, y0, cut, y1]))
            text = " ".join(w[4] for w in ws)
            for label, sid in section_keys:
                if sid not in anchors and re.match(rf"^{label}(\s|$)", text) and not (label == "Section I" and text.startswith("Section II")):
                    if sid == "s2b" and "s2" not in anchors:
                        continue  # 写作部分也有 Part B，只认阅读里的
                    anchors[sid] = (pi + 1, r([x0, y0, x1, y1]))
            # 段落排序的序列行：41. →42.→F→43. →44.→C→45.
            if "→" in text:
                for n in range(41, 46):
                    for rect in page.search_for(f"{n}."):
                        if abs(rect.y0 - y0) < 6 and n not in pos:
                            pos[n] = (pi + 1, r(rect))
        # 翻译的划线句标号在段落中间
        for w in words:
            m = re.fullmatch(r"(4[6-9]|50)\)", w[4])
            if m and int(m.group(1)) not in pos:
                pos[int(m.group(1))] = (pi + 1, r(w[:4]))
    return pos, anchors


def find_blanks(doc, numbers):
    """完形填空文章里的空位 "__1__"，在空位上也能作答、显示所选的词"""
    blanks = {}
    for n in numbers:
        for pi, page in enumerate(doc):
            hits = page.search_for(f"__{n}__")
            if hits:
                blanks[n] = (pi + 1, [round(v, 1) for v in hits[0]])
                break
    return blanks


def apply_corrections(paper, year):
    """按对照表修正录入错误：只在指定的部分、题组或题目里改，按整词匹配；找不到就报出来"""
    for where, wrong, right in CORRECTIONS.get(year, []):
        target = find_node(paper, where)
        pat = re.compile(rf"(?<![A-Za-z]){re.escape(wrong)}(?![A-Za-z])")
        if target is None or not replace_once(target, pat, right):
            print(f"  修正未命中（{where}）：{wrong}")
    return paper


def build(year):
    paper_pdf = RAW / f"kaoyan1-{year}.pdf"
    ans = parse_answers(RAW / f"kaoyan1-{year}-answers.pdf")
    p = parse_paper(paper_pdf)

    def with_answer(q):
        a = ans.get(q["number"], {})
        if a.get("answer"):
            q["answer"] = a["answer"]
        if a.get("explanation"):
            q["explanation"] = a["explanation"]
        return q

    # 原卷 PDF：去水印，导出每页单词坐标，定位题号和各部分标题
    out_dir = ROOT / "public/papers/pdf"
    out_dir.mkdir(parents=True, exist_ok=True)
    pid = f"kaoyan1-{year}"
    doc = clean_pdf(paper_pdf, out_dir / f"{pid}.pdf")
    pages = [page_words(page) for page in doc]
    (out_dir / f"{pid}.words.json").write_text(json.dumps({"pages": pages}, ensure_ascii=False, separators=(",", ":")), "utf-8")
    pos, anchors = find_positions(doc)
    blanks = find_blanks(doc, [q["number"] for q in p["cloze"]["questions"]])

    order_keys = [x["key"] for x in p["order"]["paragraphs"]]
    paper = {
        "id": f"kaoyan1-{year}",
        "exam": "kaoyan1",
        "year": year,
        "title": f"{year} 年考研英语（一）",
        "heading": f"{year} 年全国硕士研究生入学统一考试英语（一）试题",
        "label": "真题",
        "note": "原卷 PDF 来自网络转载的文字版，已去掉页脚水印；答案与解析来自同一来源的答案详解。",
        "pdf": {"src": f"/papers/pdf/{pid}.pdf", "words": f"/papers/pdf/{pid}.words.json"},
        "durationMinutes": 180,
        "sections": [
            {
                "id": "s1",
                "part": "Section I",
                "title": "Use of English",
                "kind": "cloze",
                "directions": p["cloze"]["directions"],
                "groups": [{"id": "s1g1", "passage": {"paragraphs": p["cloze"]["paragraphs"]}, "questions": [with_answer(q) for q in p["cloze"]["questions"]]}],
            },
            {
                "id": "s2",
                "part": "Section II",
                "title": "Reading Comprehension",
                "subtitle": "Part A",
                "kind": "reading",
                "directions": p["reading"]["directions"],
                "groups": [
                    {"id": f"t{i + 1}", "title": t["title"], "passage": {"paragraphs": t["paragraphs"]}, "questions": [with_answer(q) for q in t["questions"]]}
                    for i, t in enumerate(p["reading"]["texts"])
                ],
            },
            {
                "id": "s2b",
                "part": "Section II",
                "title": "Reading Comprehension",
                "subtitle": "Part B",
                "kind": "order",
                "directions": p["order"]["directions"],
                "groups": [
                    {
                        "id": "pb",
                        "passage": {"paragraphs": [f"{x['key']}. {x['text']}" for x in p["order"]["paragraphs"]]},
                        "sequence": p["order"]["sequence"],
                        "questions": [
                            with_answer({"id": f"q{n}", "number": n, "options": [{"key": k, "text": ""} for k in order_keys]})
                            for n in range(41, 46)
                        ],
                    }
                ],
            },
            {
                "id": "s2c",
                "part": "Section II",
                "title": "Reading Comprehension",
                "subtitle": "Part C",
                "kind": "translation",
                "directions": p["translation"]["directions"],
                "groups": [
                    {
                        "id": "pc",
                        "passage": {"paragraphs": p["translation"]["paragraphs"]},
                        "questions": [
                            {
                                "id": f"q{n}",
                                "number": n,
                                "stem": p["translation"]["segments"][n],
                                "reference": ans.get(n, {}).get("reference", ""),
                                **({"explanation": ans[n]["explanation"]} if ans.get(n, {}).get("explanation") else {}),
                            }
                            for n in range(46, 51)
                        ],
                    }
                ],
            },
            {
                "id": "s3",
                "part": "Section III",
                "title": "Writing",
                "kind": "writing",
                "groups": [
                    {"id": "w1", "title": "Part A", "questions": [{"id": "q51", "number": 51, "stem": p["writing"]["a"], "reference": ans.get(51, {}).get("reference", "")}]},
                    {
                        "id": "w2",
                        "title": "Part B",
                        "questions": [{"id": "q52", "number": 52, "stem": p["writing"]["b"], "reference": ans.get(52, {}).get("reference", "")}],
                    },
                ],
            },
        ],
    }
    paper = apply_corrections(paper, year)
    for sec in paper["sections"]:
        if sec["id"] in anchors:
            sec["anchor"] = {"page": anchors[sec["id"]][0], "box": anchors[sec["id"]][1]}
        for g in sec["groups"]:
            for q in g["questions"]:
                if q["number"] in pos:
                    q["page"], q["box"] = pos[q["number"]]
                if sec["kind"] == "cloze" and q["number"] in blanks:
                    q["blank"] = {"page": blanks[q["number"]][0], "box": blanks[q["number"]][1]}
    out = ROOT / "public/papers" / f"kaoyan1-{year}.json"
    out.write_text(json.dumps(paper, ensure_ascii=False, indent=2) + "\n", "utf-8")

    qs = [q for s in paper["sections"] for g in s["groups"] for q in g["questions"]]
    no_ans = [q["number"] for q in qs if q.get("options") and not q.get("answer")]
    no_ref = [q["number"] for q in qs if not q.get("options") and not q.get("reference")]
    print(f"{paper['id']}: {len(qs)} 题；完形 {len(p['cloze']['questions'])} 空，阅读 {len(p['reading']['texts'])} 篇，排序段落 {''.join(order_keys)}，翻译划线 {len(p['translation']['segments'])} 句")
    print(f"  原卷 {len(pages)} 页，{sum(len(x['w']) for x in pages)} 个可点击单词；定位题号 {sum(1 for q in qs if 'box' in q)}/{len(qs)}，完形空位 {len(blanks)}，部分标题 {', '.join(anchors)}")
    missing = [q["number"] for q in qs if "box" not in q]
    if missing:
        print("  未定位题号：", missing)
    if no_ans:
        print("  缺答案：", no_ans)
    if no_ref:
        print("  缺参考答案：", no_ref)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    build(int(sys.argv[1]) if len(sys.argv) > 1 else 2019)
