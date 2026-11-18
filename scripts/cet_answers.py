"""从四六级真题的"解析"PDF 里取出答案、解析、参考作文和参考译文（给 import_cet.py 用）。

各家解析的版式差得很远（"答案：D"、"选项C是正确答案"、"A)【精析】"、"26.M)rest"、"37. ... [E]"……），
做法是：先按题号把解析切成一块一块（题号是行首的 "12."，从 1 到 55 递增），
再在每一块里用一组句式找答案字母；同一块里几个句式的结论不一致就记为冲突，交给调用方决定要不要导入。
扫描页没有文字层，用 cet_ocr 先识别（识别结果有缓存）。
"""
import re
import sys
from pathlib import Path

import fitz

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cet_ocr  # noqa: E402

CJK = re.compile(r"[一-鿿]")
LETTER = "A-T"

# (名字, 正则, 权重)：捕获组 1 是答案字母。前一组在拼起来的整块文字里找，后一组按行首找
L = r"([A-T])(?![A-Za-z])"
SENTENCE = [
    ("答案：X", re.compile(r"答[\s」』|!！]*案\s*[:：∶]\s*[（(]?" + L), 3),
    ("正确答案X", re.compile(r"(?:正确答案|参考答案|本题答案)\s*[:：为是选]?\s*[（(]?" + L), 3),
    ("选项X是正确答案", re.compile(r"选项\s*([A-T])\s*(?:是|为)\s*(?:本题的?)?(?:正确|最佳)?\s*答[\s」』|!！]*案"), 3),
    ("故X为答案", re.compile(r"(?:故|因此|所以|则|即)\s*[（(]?([A-T])\s*[)）]?\s*(?:项|选项)?\s*(?:是|为)\s*(?:本题的?)?(?:正确)?\s*(?:答[\s」』|!！]*案|选项)"), 3),
    ("答案为X", re.compile(r"答[\s」』|!！]*案\s*(?:为|是|选|应选|应为|即为)\s*[（(]?" + L), 3),
    ("此题选X", re.compile(r"(?:此题|本题|该题)\s*(?:应)?选\s*(?:择)?\s*(?:项)?\s*[（(]?" + L), 3),
    ("故选X", re.compile(r"(?:故|因此|所以|应)\s*(?:本题)?\s*选\s*(?:择)?\s*(?:项)?\s*[（(]?" + L + r"(?![和与、及或,，错不没])"), 2),
    ("X为答案", re.compile(r"(?<![A-Za-z])([A-T])\s*(?:是|为)\s*(?:本题的?)?(?:正确)?\s*答[\s」』|!！]*案"), 3),
    ("X项为答案", re.compile(r"(?<![A-Za-z])([A-T])\s*[)）]?\s*项\s*(?:是|为)\s*(?:本题的?)?(?:正确)?\s*答[\s」』|!！]*案"), 3),
    ("X项…故为答案", re.compile(r"(?:选项\s*|(?<![A-Za-z]))([A-T])\s*[)）]?\s*(?:项)?[^。！？;；]{0,120}?(?:(?:故|因此|所以)\s*(?:该选项|该项)?\s*(?:为|是)|[,，]\s*(?:为|是))\s*(?:本题的?)?(?:正确)?\s*(?:答[\s」』|!！]*案|选项)"), 2),
    ("X)…故正确", re.compile(r"(?<![A-Za-z])([A-T])\s*[)）]\s*[^。！？]{0,12}?[,，]?\s*故\s*(?:正确|选|为答案)"), 3),
    ("X项与…相符", re.compile(r"(?<![A-Za-z])([A-T])\s*(?:项|选项)\s*与(?:(?!不|未|没|无|非|相悖|矛盾)[^。！？;；]){0,20}?(?:相符|一致|吻合|对应)"), 3),
    ("X项…故正确", re.compile(r"(?<![A-Za-z])([A-T])\s*(?:项|选项)[^。！？;；]{0,40}?故\s*(?:正确|选)"), 3),
    ("故X项正确", re.compile(r"故\s*([A-T])\s*(?:项|选项)\s*正确"), 3),
    ("选项X…是正确答案", re.compile(r"选项\s*([A-T])[^。！？;；]{0,25}?(?:是|为)\s*(?:正确|最佳)\s*(?:答案|选项)"), 3),
    ("X项符合题意", re.compile(r"(?<![A-Za-z])([A-T])\s*(?:项|选项)\s*(?:符合题意|最符合题意|符合题干)"), 3),
    ("选项X…故正确", re.compile(r"选项\s*([A-T])[^。！？;；]{0,40}?故\s*(?:正确|选)"), 3),
    ("故X正确", re.compile(r"故\s*([A-T])\s*(?:项|选项)?\s*正确(?![地的性解确])"), 3),
    ("选项X正是", re.compile(r"选项\s*" + L + r"\s*(?:正是|就是|才是)"), 2),
    ("选项X吻合", re.compile(r"选项\s*" + L + r"(?![^。！？;；]{0,12}[不未没无非悖矛])[^。！？;；]{0,30}?(?:吻合|相符|一致|对应|符合)"), 2),
    ("选X正确", re.compile(r"选\s*项\s*" + L + r"\s*正\s*确"), 3),
    ("选项X…故为答案", re.compile(r"选项\s*([A-T])[^。！？;；]{0,40}?故\s*(?:为|是)\s*(?:正确)?\s*答[\s」』|!！]*案"), 3),
    # 选词填空：写 "备选副词中 J) routinely"例行地"最符合句意，故为本题答案"
    ("X)词…故为答案", re.compile(r"(?<![A-Za-z])([A-T])\s*[)）]\s*[A-Za-z-]{3,}[^。！？;；]{0,40}?故\s*(?:为|是)\s*(?:本题的?)?(?:正确)?\s*答[\s」』|!！]*案"), 3),
    ("【答案】X", re.compile(r"[【\[［L]\s*(?:锁定)?答案\s*[】\]］]\s*[:：]?\s*" + L), 3),
    ("[锁定答案X", re.compile(r"锁定答案\s*[】\]］〕」]?\s*[:：]?\s*" + L), 3),
    # "【答案】【H】【精解】【H】段……"（识别时左括号常变成「）
    ("【答案】【X】", re.compile(r"[【\[［「]\s*答案\s*[】\]］」〕]\s*[:：]?\s*[【\[［(（「]\s*([A-T0])\s*[】\]］)）」〕]"), 3),
    # 识别出来的"26.答案:1）permit""答案:0)weighing""答案:o）vanished"：字母 I、O、C 认成了 1、0、小写（后面紧跟着词库里的单词）
    ("答案：1)词", re.compile(r"答案\s*[:：;；∶]\s*([01oc])\s*[)）]\s*[A-Za-z]{3,}"), 3),
    # "C是对该信息的概括,故正确。""……,D正确。"
    ("X是…故正确", re.compile(r"(?<![A-Za-z])([A-T])\s*(?:项|选项)?\s*(?:是|为)[^。！？;；]{0,30}?[,，]\s*故\s*正确"), 3),
    ("X正确", re.compile(r"(?<![A-Za-z])([A-T])\s*正确(?![地的性解确推理])"), 3),
    # 段落匹配：解析写"……的内容出现在 B 段"（"出"有时丢了；罗马数字 Ⅰ 是 I 段）
    ("内容出现在X段", re.compile(r"(?:出现在|现在|位于|出自|见于|体现在|主要在)\s*([A-TⅠ])\s*段"), 3),
]
LINESTART = [
    ("X)【语法判断】", re.compile(r"^\s*([A-T0])\s*[)）]\s*【\s*(?:语法|词性|语义)判断"), 3),
    ("X选项正确", re.compile(r"(?<![A-Za-z])([A-T])\s*(?:选项|项)\s*正确(?![地的性解确])"), 3),
    ("[答案][X]", re.compile(r"\[\s*答案\s*\]\s*\[\s*([A-T])\s*\]"), 3),
    ("X)【精析】", re.compile(r"^\s*([A-T])\s*[)）]\s*[【\[［]\s*精析\s*[】］\]]"), 3),
    ("答案解析X.", re.compile(r"答案(?:解析|精析)\s*[\]】〕」』］]?\s*([A-T])\s*[.．。)）]"), 3),
    ("X正确", re.compile(r"(?<![A-Za-z])([A-T])\s*[)）]\s*[A-Za-z\-]{0,25}\s*正确(?![地的性解确])"), 3),
    ("[解析]X)", re.compile(r"\[\s*解析\s*\]\s*([A-T])\s*[)）]"), 3),
    ("题号X)词", re.compile(r"^\s*(?=(?:2[6-9]|3[0-5])\s*[.．、])\d{2}\s*[.．、]\s*(?:([A-T0])\s*[)）]\s*[A-Za-z]|([A-T0])(?=[a-z]{3}))"), 3),
    ("题号X", re.compile(r"^\s*\d{1,2}\s*[.．、,，]\s*([A-T])\s*$"), 2),
]
# 只认块的第一行：题号后面是汉字，行尾句号后单独一个大写字母
TAIL_LETTER = re.compile(r"^\s*\d{1,2}\s*[.．、]\s*[一-鿿][^A-Za-z]{6,}[。！？；;）)]\s*([A-T])\s*$")
BRACKET = re.compile(r"\[\s*([A-T])\s*\]")  # 段落匹配的 37. ... [E]，只认题干那一行


# 文字层里汉字是乱码的页（字体没有编码表，汉字变成 ¥£§、拉丁扩展、加拿大音节、CJK 扩展 A 之类的字符）：
# 听力页英文原文多，cet_ocr.text_ok 认为能用，可解析的汉字全是乱码，答案句式一个也找不到
GARBLED = re.compile(r"[ -¯±-¶¸-ÖØ-öø-˿᐀-᣿⬀-⯿Ⰰ-ⷿ⼀-⿟぀-ヿ㐀-䶿ꀀ-퟿]")


def garbled(lines):
    s = "".join(l["text"] for l in lines)
    n = len(GARBLED.findall(s))
    return n >= 8 and n >= 0.08 * (n + len(CJK.findall(s)))


def pages_need_ocr(pdf, doc=None):
    """解析 PDF 里要识别、还没识别的页（从 0 开始）：文字层不能用的（cet_ocr.pages_need_ocr），加上汉字是乱码的页。
    识别结果进 cet_ocr 的缓存，page_lines 读到缓存就用识别结果"""
    doc = doc or fitz.open(pdf)
    done = cet_ocr.load_cache(pdf)
    need = set(cet_ocr.pages_need_ocr(pdf, doc))
    need |= {i for i, page in enumerate(doc) if i not in done and garbled(cet_ocr.text_lines(page))}
    return sorted(need)


def _segments(words, gap):
    """同 cet_ocr.text_lines，只是输入是单词列表"""
    out = []
    for row in cet_ocr.group_rows(words):
        seg = [row[0]]
        for w in row[1:]:
            if w[0] - seg[-1][2] > gap:
                out.append(cet_ocr._row(seg))
                seg = []
            seg.append(w)
        out.append(cet_ocr._row(seg))
    return out


def text_lines(page, gap=18):
    """文字层分行（cet_ocr.text_lines），另外把页边的"题号 + 答案"标签单独成行：有的解析（2015 年四级）把题号和答案
    印在页边并排的两个高块里（"14." "D"），按纵向中心分行时会并进上一题解析的最后一行
    （"14.时成为了一名专业的小提琴手，故D"），题号认不出、答案字母还落到上一题里。
    这种标签在 PDF 自己的文字结构里单独占一行（这一行只有"题号."和一个字母），按这个认"""
    words = cet_ocr.get_words(page)
    by_line = {}
    for w in words:
        if len(w) >= 7:
            by_line.setdefault((w[5], w[6]), []).append(w)
    def glued(b):
        """字母右边紧挨着小写字母开头的词：是被拆开的单词（"M" "eri an" = Merian），不是答案"""
        c = (b[1] + b[3]) / 2
        return any(w is not b and -8 <= w[0] - b[2] < 3 and w[0] > b[0] and abs((w[1] + w[3]) / 2 - c) < 0.3 * (b[3] - b[1]) and w[4][:1].islower() for w in words)

    keys = set()
    for ws in by_line.values():
        if len(ws) == 2 and re.fullmatch(r"\d{1,2}[.．]", ws[0][4]) and re.fullmatch(r"[A-T]", ws[1][4]) and 0 <= ws[1][0] - ws[0][2] < 16 and not glued(ws[1]):
            keys |= {ws[0][:5], ws[1][:5]}
    if not keys:
        return cet_ocr.text_lines(page, gap)
    out = _segments([w for w in words if w[:5] not in keys], gap)
    for t in _segments([w for w in words if w[:5] in keys], gap):
        c = (t["y0"] + t["y1"]) / 2
        at = next((k for k, l in enumerate(out) if (l["y0"] + l["y1"]) / 2 > c), len(out))
        out.insert(at, t)
    return out


def page_lines(pdf, gap=18):
    """每页的文字行，拍平成一个列表：[{text, page, x0, y0, x1, y1}]。行里空隙超过 gap 个点就切成两段。
    文字层能用就用文字层（text_lines），扫描页、乱码页用 cet_ocr 缓存里的识别结果"""
    doc = fitz.open(pdf)
    need = cet_ocr.pages_need_ocr(pdf, doc)
    if need:  # 还没识别的扫描页先识别（结果进缓存）
        cet_ocr.run_ocr([(str(pdf), i) for i in need], workers=min(10, len(need)))
    cache = cet_ocr.load_cache(pdf)
    pages = []
    for i, page in enumerate(doc):
        if i in cache:
            lines = [{"text": t, "x0": a, "y0": b, "x1": c, "y1": d} for t, a, b, c, d, _ in cache[i]]
        else:
            lines = text_lines(page, gap)
        pages.append(cet_ocr.order_columns(lines, page.rect.width))
    out = []
    for pi, lines in enumerate(pages):
        for l in lines:
            out.append({"text": l["text"].strip(), "page": pi + 1, "x0": l["x0"], "y0": l["y0"], "x1": l["x1"], "y1": l["y1"]})
    return out


# "12." "12、"，或题号后直接跟英文题干（"12What…"），或逗号后跟英文题干（"16, What does…"）
ANCHOR = re.compile(r"^\s*(?:[|Il]\s+)?(\d{1,2})\s*(?:[.．、]\s*(?=\S)|[1lI|]?\s*(?=[A-Z][a-z]{2})|[,，]\s*(?=[A-Z][a-z]{2}))")
SHORT_ENTRY = re.compile(r"^\s*\d{1,2}\s*[.．、,，]?\s*[A-T]\s*$")
WEAK_ANCHOR = re.compile(r"^\s*(?:[|Il]\s+)?(\d{1,2})\s*(?=[一-鿿“\"])")
OPTION_A = re.compile(r"^\s*(?:\d{1,2}\s*[.．、]\s*)?A\s*[)）]")


def find_anchors(lines, total=55):
    """题号锚点：行首的 "12."。从后往前取每个题号"最后一次出现在下一题之前"的那一行；
    没有句点的（"50金融知识……"）只在找不到带句点的时候才算"""
    cands = {}
    for k, l in enumerate(lines):
        m = ANCHOR.match(l["text"])
        if m and 1 <= int(m.group(1)) <= total:
            cands.setdefault(int(m.group(1)), []).append((k, True))
            continue
        m = WEAK_ANCHOR.match(l["text"])
        if m and 1 <= int(m.group(1)) <= total:
            cands.setdefault(int(m.group(1)), []).append((k, False))
    # 答案速查表：一页上有 8 行以上单独的 "54. B"
    short_by_page = {}
    for k, l in enumerate(lines):
        if SHORT_ENTRY.match(l["text"]):
            short_by_page.setdefault(l["page"], []).append(k)
    table = {k for ks in short_by_page.values() if len(ks) >= 8 for k in ks}
    anchors, limit = {}, len(lines)
    for n in range(total, 0, -1):
        ks = [(k, strong) for k, strong in cands.get(n, []) if k < limit]
        strong = [k for k, s_ in ks if s_]
        # 卷末的"答案速查表"（连着十几行 "54. B"）排在最后，会抢走真正的题号行：有别的候选就不要它
        if len(strong) >= 2 and strong[-1] in table:
            real = [k for k in strong if k not in table]
            if real:
                strong = real
        # 页边标签"1. B"（题号和答案，不是答案速查表）就是这道题的开头；题后【听前预测】里的"1. 四项均……"
        # "2. 三项……"编号列表排在它后面，会抢走题号
        label = [k for k in strong if SHORT_ENTRY.match(lines[k]["text"]) and k not in table]
        if label and label[-1] != strong[-1] and strong[-1] - label[-1] <= 12:
            strong = label
        # 解析书里的"语篇分析"图表也有带编号的行（"5.顾客说明买葡萄……"），会抢走真正的题号行：
        # 有几个候选时，优先要后面几行里紧跟着 A) 选项的那个（解析书把题干和选项重抄一遍）
        if len(strong) >= 2:
            opt = [k for k in strong if any(OPTION_A.match(l["text"]) for l in lines[k : k + 5])]
            if opt and opt != strong:
                strong = opt
        pick = strong[-1] if strong else (ks[-1][0] if ks else None)
        if pick is not None:
            anchors[n] = pick
            limit = pick
    return anchors


def extra_anchors(lines, anchors, total=55):
    """按顺序规则丢掉的题号（左右两栏并排的页，右栏的第 6 题在列表里排在左栏第 5 题前面，"必须在下一题之前"会把第 5 题丢掉）：
    候选行和前后已找到的题要么顺序对，要么在同一页的另一栏。返回 {题号: 行号}，只给没找到的题；
    不改动已有的锚点，用的时候也只取这些题自己的那一栏的块"""
    cands = {}
    for k, l in enumerate(lines):
        m = ANCHOR.match(l["text"])
        if m and 1 <= int(m.group(1)) <= total:
            cands.setdefault(int(m.group(1)), []).append(k)
    page_w = {}
    for l in lines:
        page_w[l["page"]] = max(page_w.get(l["page"], 0), l["x1"])

    def col(k):
        return 1 if lines[k]["x0"] >= 0.47 * page_w[lines[k]["page"]] else 0

    def consistent(k, other, k_before):
        if (k > other) if k_before else (k < other):
            return True
        return lines[k]["page"] == lines[other]["page"] and col(k) != col(other)

    out = {}
    for n in range(1, total + 1):
        if n in anchors:
            continue
        before = max((m for m in anchors if m < n), default=None)
        after = min((m for m in anchors if m > n), default=None)
        ok = [k for k in cands.get(n, []) if k not in anchors.values()
              and (before is None or consistent(k, anchors[before], True))
              and (after is None or consistent(k, anchors[after], False))]
        if ok:
            out[n] = ok[-1]
    return out


def loose_start(m):
    """第 m 题开头的宽松写法（"52:"、"【52】"、"Q52."、题号后直接跟汉字）：只用来截断块，不当锚点"""
    return re.compile(rf"^\s*(?:[|Il]\s+)?(?:[\[【(（]\s*|Q\s*)?{m}\s*[\]】)）]?\s*(?:[.．、,，:：;；∶]|(?=[一-鿿【\[]))")


def cut_before(lines, k, end, n, nxt):
    """第 n 题的块是 lines[k:end]，下一个找到的题号是 nxt。中间有题号没找到（nxt 不是 n+1）时，
    块里会混进那几道题的解析：在块里找它们宽松写法的题号，从最早的那一行截断。返回新的终点"""
    if nxt == n + 1:
        return end
    pats = [loose_start(m) for m in range(n + 1, nxt)]
    for j in range(k + 1, end):
        if any(p.match(lines[j]["text"]) for p in pats):
            return j
    return end


def join_lines(lines, swap=False):
    """块里的行拼成一段。swap=True 时把 y 坐标几乎相同（差不到 4 点）的相邻两行对调：
    段落第一行前面有小图标时，识别出来它会比第二行低一点，顺序就反了"""
    ls = list(lines)
    # 段落第一行前面的"解"图标和第二行前面的"析"图标：识别后"析"那行有时排到前面，对调回来
    for i in range(len(ls) - 1):
        if ls[i]["text"][:1] == "析" and ls[i + 1]["text"][:1] == "解" and ls[i]["page"] == ls[i + 1]["page"]:
            ls[i], ls[i + 1] = ls[i + 1], ls[i]
    if swap:
        i = 0
        while i + 1 < len(ls):
            if 0 < ls[i + 1]["y0"] - ls[i]["y0"] < 6 and ls[i]["page"] == ls[i + 1]["page"]:
                ls[i], ls[i + 1] = ls[i + 1], ls[i]
                i += 1
            i += 1
    out = ""
    for l in ls:
        t = l["text"]
        if len(t.strip()) <= 2 and CJK.search(t):
            continue  # 版面上夹在行间的"解析""定位"小图标
        t = re.sub(r"^[！!」』|\s]+", "", t)  # 识别时行首常多出来的竖线、叹号
        t = re.sub(r"^[析解][」』|\s]*(?=\S)", "", t) if t[:1] == "析" else t
        if out and not (CJK.search(out[-1]) or CJK.search(t[:1])):
            out += " "
        out += t
    return out


def eliminated(text):
    """文字里明确排除了 A–D 里的三个，返回剩下的那个；否则 None"""
    out = set()
    for m in re.finditer(r"排除\s*(?:选项|选|项)?\s*([A-D])(?![A-Za-z])(?:\s*[、和与及]\s*([A-D])(?![A-Za-z]))?(?:\s*[、和与及]\s*([A-D])(?![A-Za-z]))?", text):
        out.update(g for g in m.groups() if g)
    for m in re.finditer(r"(?:选项|选)?\s*([A-D])(?:\s*[、和与及]\s*(?:选项|选)?([A-D]))?(?:\s*[、和与及]\s*(?:选项|选)?([A-D]))?\s*(?:项|选项)?[^。；;！？]{0,25}?(?:不符|排除|错误|不正确|与原文无关|未提及)", text):
        out.update(g for g in m.groups() if g)
    if len(out) == 3:
        return next(iter(set("ABCD") - out))
    return None


# 明确写出答案的句式：一道题的解析里只出现一次。同一块里有两个不同字母的，说明块跨了两道题（后一题的题号没认出来）
EXPLICIT = {"答案：X", "正确答案X", "答案为X", "【答案】X", "【答案】【X】", "[锁定答案X", "答案：1)词"}


def block_letters(block):
    """一块里各句式找到的答案字母：返回 (答案, 说明)"""
    score, explicit = {}, set()

    def add(letter, w):
        letter = {"0": "O", "1": "I", "Ⅰ": "I", "o": "O", "c": "C"}.get(letter, letter)
        score[letter] = score.get(letter, 0) + w
        return letter

    text = join_lines(block)
    for name, pat, w in SENTENCE:
        for m in pat.finditer(text):
            letter = add(m.group(1), w)
            if name in EXPLICIT:
                explicit.add(letter)
    if not score:
        text = join_lines(block, swap=True)
        for name, pat, w in SENTENCE:
            for m in pat.finditer(text):
                letter = add(m.group(1), w)
                if name in EXPLICIT:
                    explicit.add(letter)
    if len(explicit) > 1:
        return None, "冲突：块里有两个不同的明确答案 " + ",".join(sorted(explicit))
    for k, l in enumerate(block):
        for name, pat, w in LINESTART:
            m = pat.search(re.sub(r"^[！!」』|\s]+", "", l["text"]))
            if m:
                add(next(g for g in m.groups() if g), w)
        if k == 0:
            for m in BRACKET.finditer(l["text"]):
                add(m.group(1), 1)
            m = TAIL_LETTER.match(l["text"])
            if m:
                add(m.group(1), 2)
    if not score:
        # 没有直接的答案句式：三个选项都被明确排除了，剩下的那个就是
        left = eliminated(join_lines(block, swap=True))
        if left:
            return left, 1
        return None, "没找到"
    best = max(score.values())
    top = [k for k, v in score.items() if v == best]
    if len(top) > 1:
        return None, "冲突：" + ",".join(f"{k}={v}" for k, v in score.items())
    strong_other = [k for k, v in score.items() if k != top[0] and v >= 3]
    if strong_other and best < 2 * max(score[k] for k in strong_other):
        return None, "冲突：" + ",".join(f"{k}={v}" for k, v in score.items())
    return top[0], best


EXPL_START = re.compile(r"^\s*(?:解\s*[→>}年\-—•]|答案解析|语法判断|语义判断|详解|解析\s*[:：∶]|【精析】|\[?精析\]?|【解析】|解题思路|定\s*根据|定位)")
FOOTER = re.compile(r"^\s*\d{0,3}\s*(?:四级|六级)\s*\d{4}[.．]?\d{0,2}.*$|^\s*(?:第\s*)?\d{1,3}\s*页\s*$")
HEAD = re.compile(r"^[·•\s]*(听力原文|答案详解|全文翻译|概览|重难点|难词译注|词汇|Section|Passage|Part|News Report|Conversation|Recording)")


# 页眉页脚：出现在一行里任何位置都去掉（两栏挤在一行时，页脚会夹在正文中间）
FOOTER_ANY = re.compile(
    r"\d{2,4}\s*年\s*\d{1,2}\s*月\s*大学英语[四六]级考试真题答案详解\s*[(（]\s*共\s*\d\s*套\s*[)）]\s*[.．·]?\s*(?:第\s*\d\s*套)?\s*\d{0,3}"
    r"|\d{2,4}\s*年\s*\d{1,2}\s*月\s*[四六]级(?:真题)?\s*第\s*\d\s*套\s*详解\s*第\s*\d+\s*页\s*[，,]\s*共\s*\d+\s*页"
    r"|第\s*\d+\s*页\s*[，,]\s*共\s*\d+\s*页"
    r"|(?:\d{4}\s*\.\s*\d{1,2}\s*/\s*)?\d{1,3}\s*[(（]\s*第\s*[\d一二三]\s*套\s*[)）]"
    r"|[四六]级\s*\d{4}\s*(?:年\s*\d{1,2}\s*月|\.\s*\d{1,2})\s*(?:真题\s*[（(][一二三][）)]|第[一二三]套)?\s*\d{1,3}(?![\d年月])"
)
# 选项行：字母后面紧跟英文单词（"A) It is ..."）；"L）【语法判断】……" "C）细节推断题" 不是
OPTION_EN = re.compile(r"^\s*[A-T]\s*[)）]\s*[A-Za-z\"“'‘]")
OPTION_ZH = re.compile(r"^\s*[A-D]\s*[)）]\s*[一-鿿“\"（(]")


def strip_footer(t):
    return re.sub(r"\s{2,}", " ", FOOTER_ANY.sub(" ", t)).strip()


def tidy_explanation(block, anchor_line=None):
    """块里取解释文字：从"解→""详解""语法判断"这类开头算起；去掉选项、页脚、版面小图标；碰到英文原文（听力原文）就停。
    题号那一行本身就是解析正文的（"45.【定位】由题干中的……"），从这一行开始取，不然解析开头会少一截（"位到第二段……"）"""
    head = re.sub(r"^\s*\D{0,3}?\d{1,2}\s*[.．、,，:：;；]\s*", "", block[0]["text"]) if block else ""
    if head and (head[:1] in "【[［「" or re.match(r"^.{0,16}?(?:定位|精析|解析|考点|答案|详解)", head)) and not re.match(r"^[【\[［]?\s*(?:听前预测|做题提示|设题要点|看选项)", head):
        start = 0
    else:
        start = next((k for k, l in enumerate(block) if k > 0 and EXPL_START.match(l["text"])), None)
    out = []
    for k, l in enumerate(block):
        t = l["text"] if k else head
        if (k == 0 and start != 0) or (start is not None and k < start):
            continue
        t = strip_footer(re.sub(r"^[！!」』|\s]+", "", t))
        if not t or (len(t) <= 2 and CJK.search(t)):
            continue
        if FOOTER.match(t) or HEAD.match(t):
            if out and HEAD.match(t):
                break
            continue
        if not CJK.search(t):
            if out and len(t) > 25:
                break
            continue
        if OPTION_EN.match(t) and len(re.findall(r"[A-Za-z]", t)) > len(re.findall(r"[一-鿿]", t)):
            continue  # 英文的选项行
        if not out and OPTION_ZH.match(t) and len(t) < 40 and not re.search(r"精析|详解|解析|答案|故|因此", t):
            continue  # 解析开头抄的选项译文（"A）她在值班。"）
        t = re.sub(r"^\s*[A-T]\s*[)）]\s*[。.]?\s*(?:详解|解析|精析|【精析】)?\s*[:：]?\s*", "", t) if re.match(r"^\s*[A-T]\s*[)）]\s*[。.]?\s*(?:详解|解析|精析|【精析】)", t) else t
        out.append(t)
    text = ""
    for t in out:
        if text and not (CJK.search(text[-1]) or CJK.search(t[:1])):
            text += " "
        text += t
    # 开头残留的英文题干后半截（"subjective universe?汤姆……"）、选项译文（"C）它是……。 D)它是……。解文章中间部分提到……"）
    text = re.sub(r"^[A-Za-z][^一-鿿?？]{0,80}[?？]\s*", "", text)
    text = re.sub(r"^(?:[A-D]?\s*[)）][^【\[。]{1,45}[。.]\s*){2,4}(?=解|【|\[)", "", text)
    text = re.sub(r"^(?:解\s*[→>}年\-—•]?\s*析?)\s*", "", text)
    text = strip_footer(re.sub(r"\s+", " ", text))
    text = re.sub(r"^[：:∶;；,，。.、\s]+", "", text)  # 去掉"解析："这类小标题后留下的冒号
    return text[:1500]


def bank_fill(lines, result, bank):
    """选词填空（26–35）解析只写词不写字母（"备选名词中，mood 符合句意，故为答案"）：按原卷的词库 bank={字母: 词}
    把词对回字母。只在块结尾（最后 90 个字）里恰好提到词库里一个词时才取；返回 {题号: {...}}"""
    import re as _re

    anchors = find_anchors(lines, 55)
    order = sorted(anchors)
    out = {}
    for i, n in enumerate(order):
        if not 26 <= n <= 35 or n in result:
            continue
        k = anchors[n]
        end = anchors[order[i + 1]] if i + 1 < len(order) else min(len(lines), k + 40)
        block = lines[k:end]
        text = join_lines(block, swap=True)
        tail = text[-90:]
        hits = {}
        for letter, word in bank.items():
            w = word.lower()
            pat = w[: max(5, len(w) - 3)] if len(w) >= 7 else w
            if _re.search(r"(?<![A-Za-z])" + _re.escape(pat), tail.lower()):
                hits[letter] = word
        if len(hits) == 1:
            letter = next(iter(hits))
            out[n] = {"answer": letter, "explanation": tidy_explanation(block), "score": 2, "twocol": False}
    return out


def parse_answers(pdf, total=55, bank=None):
    """返回 {题号: {"answer", "explanation"}}、问题列表、行列表。bank 是原卷选词填空的词库 {字母: 词}（可选）。
    取不全时换一种切行（行内空隙超过 6 点就切开，对左右两栏挤在一行的文字层有用）再取一遍，只补没取到的题"""
    result, problems, lines = _parse(pdf, total, 18, False)
    # 再按栏取一遍（只取自己那一栏的行）：两种方式答案不一样的题不可信（多半是两栏的行混在了一起），不要
    r_col, _, _ = _parse(pdf, total, 18, True)
    r_all, _, _ = _parse(pdf, total, 18, "all")
    conflict = []
    for n in list(result):
        if n in r_col and r_col[n]["answer"] != result[n]["answer"]:
            sa, sb = result[n].get("score", 0), r_col[n].get("score", 0)
            if sa >= 2 * sb:
                continue  # 整块取的证据明显更强
            del result[n]
            conflict.append(n)
            problems.append((n, f"整块和按栏取出的答案不一致（{r_col[n]['answer']}）"))
    for n, v in result.items():
        # 两栏并排的页：解释用按栏取的；按栏取不到解释就留空，免得把隔壁那道题的解释放到这题下面
        if n in r_col and r_col[n]["answer"] == v["answer"] and r_col[n]["explanation"]:
            v["explanation"] = r_col[n]["explanation"]
        elif v.get("twocol"):
            v["explanation"] = ""
    # 整块里有两个不同的明确答案（混进了隔壁那道题的结尾）：按栏取出的答案正好是其中之一，就用按栏的
    for n, why in problems:
        m = re.match(r"冲突：块里有两个不同的明确答案 ([A-T,]+)$", why)
        if m and n not in result and n in r_all and r_all[n]["answer"] in m.group(1).split(","):
            result[n] = r_all[n]
    if len(result) < total:
        r2, p2, l2 = _parse(pdf, total, 6, False)
        for n, v in r2.items():
            if n not in result and n not in conflict:
                result[n] = v
    if bank and len(bank) >= 12:
        for n, v in bank_fill(lines, result, bank).items():
            if n not in conflict:
                result[n] = v
    problems = [(n, w) for n, w in problems if n not in result or n in conflict]
    return result, problems, lines


def _parse(pdf, total, gap, colaware):
    """colaware：False 整块取；True 只在左右并排的两栏页按栏取；"all" 所有两栏页都按栏取（包括报纸式）"""
    lines = page_lines(pdf, gap)
    anchors = find_anchors(lines, total)
    result, problems = {}, {}
    order = sorted(anchors)
    page_w = {}
    for l in lines:
        page_w[l["page"]] = max(page_w.get(l["page"], 0), l["x1"])

    # 左右两栏并排排版的页：有的题号在左栏、有的在右栏。每道题的块只取自己这一栏的行
    left_pages = {lines[k]["page"] for k in anchors.values() if lines[k]["x0"] < 0.3 * page_w[lines[k]["page"]]}
    right_pages = {lines[k]["page"] for k in anchors.values() if lines[k]["x0"] > 0.45 * page_w[lines[k]["page"]]}
    twocol_all = left_pages & right_pages
    # "报纸式"两栏（左栏读完接右栏，左栏的题号都比右栏小）：一道题从左栏底下接到右栏顶上，按阅读顺序整块取才对，
    # 按栏切会把右栏那半截（答案常在里面）切掉。只有左右并排（左 n、右 n+1 交错）的页才按栏取
    flow = set()
    for p in twocol_all:
        ns = [(n, lines[k]["x0"] < 0.47 * page_w[p]) for n, k in anchors.items() if lines[k]["page"] == p]
        left = [n for n, is_left in ns if is_left]
        right = [n for n, is_left in ns if not is_left]
        if left and right and max(left) < min(right):
            flow.add(p)
    twocol = {False: set(), True: twocol_all - flow, "all": twocol_all}[colaware]

    def col(l):
        return 1 if l["x0"] >= 0.47 * page_w[l["page"]] else 0

    def crossing(l):
        return l["x0"] < 0.47 * page_w[l["page"]] and l["x1"] > 0.6 * page_w[l["page"]]

    def block_of(i):
        n = order[i]
        k = anchors[n]
        a = lines[k]
        if a["page"] in twocol:
            c = col(a)
            end = None
            for j in range(i + 1, len(order)):
                b = lines[anchors[order[j]]]
                if b["page"] != a["page"] or col(b) == c:
                    end = anchors[order[j]]
                    break
            if end is None:
                end = min(len(lines), k + 40)
            return [l for l in lines[k:end] if l["page"] != a["page"] or col(l) == c or crossing(l)]
        end = anchors[order[i + 1]] if i + 1 < len(order) else min(len(lines), k + 40)
        nxt = order[i + 1] if i + 1 < len(order) else total + 1
        return lines[k : cut_before(lines, k, end, n, nxt)]

    for i, n in enumerate(order):
        block = block_of(i)
        letter, why = block_letters(block)
        if letter is None:
            problems[n] = why
        else:
            result[n] = {"answer": letter, "explanation": tidy_explanation(block), "score": why, "twocol": lines[anchors[n]]["page"] in twocol_all}
    # 左右两栏并排的两道题（左栏是第 n 题、右栏是第 n+1 题）：按栏把行分开再取一遍
    for i in range(len(order) - 1):
        n, m = order[i], order[i + 1]
        if m != n + 1 or (n in result and m in result):
            continue
        la, lb = lines[anchors[n]], lines[anchors[m]]
        pw = page_w[la["page"]]
        if la["page"] != lb["page"] or not (la["x0"] < 0.3 * pw and lb["x0"] > 0.45 * pw):
            continue
        end = anchors[order[i + 2]] if i + 2 < len(order) else min(len(lines), anchors[m] + 40)
        span = lines[anchors[n] : end]
        left = [l for l in span if l["page"] != la["page"] or l["x0"] < 0.47 * pw]
        right = [l for l in span if l["page"] == la["page"] and l["x0"] >= 0.47 * pw]
        l1, w1 = block_letters(left)
        l2, w2 = block_letters(right)
        if l1 and l2:
            result[n] = {"answer": l1, "explanation": tidy_explanation(left), "score": w1}
            result[m] = {"answer": l2, "explanation": tidy_explanation(right), "score": w2}
            problems.pop(n, None)
            problems.pop(m, None)
    # 右栏那道题的题号没识别出来：左栏第 n 题的块里混进了右栏的行，按栏拆开，右栏那份算第 n+1 题
    for i, n in enumerate(order):
        if n + 1 in anchors or n >= total:
            continue
        la = lines[anchors[n]]
        pw = page_w[la["page"]]
        if la["x0"] >= 0.3 * pw:
            continue
        block = block_of(i)
        left = [l for l in block if l["page"] != la["page"] or l["x0"] < 0.47 * pw]
        right = [l for l in block if l["page"] == la["page"] and l["x0"] >= 0.47 * pw]
        if len(right) < 3:
            continue
        l1, w1 = block_letters(left)
        l2, w2 = block_letters(right)
        if l1:
            result[n] = {"answer": l1, "explanation": tidy_explanation(left), "score": w1}
            problems.pop(n, None)
        else:
            result.pop(n, None)  # 左栏单独取不出答案，原来整块取的可能是右栏的，不要
        if l2:
            result[n + 1] = {"answer": l2, "explanation": tidy_explanation(right), "score": w2}
    # 按顺序规则丢掉的题：用额外锚点取这道题自己那一栏的块（块的终点是后面最近的一个已有锚点）
    starts = sorted(anchors.values())
    for n, k in extra_anchors(lines, anchors, total).items():
        if n in result:
            continue
        a = lines[k]
        nxt = next((j for j in starts if j > k), min(len(lines), k + 40))
        c = col(a)
        block = [l for l in lines[k:nxt] if l["page"] != a["page"] or col(l) == c or crossing(l)]
        letter, why = block_letters(block)
        if letter is None:
            problems[n] = why
        else:
            result[n] = {"answer": letter, "explanation": tidy_explanation(block), "score": why, "twocol": a["page"] in twocol_all}
            problems.pop(n, None)
            anchors = dict(anchors)
            anchors[n] = k
    out = [(n, w) for n, w in sorted(problems.items()) if n not in result]
    for n in range(1, total + 1):
        if n not in anchors and n not in result:
            out.append((n, "没找到题号"))
    return result, out, lines


def _paragraphs(rows):
    """英文行拼成段落：行首明显缩进的开始新段，行尾连字符直接接上"""
    left = min(r["x0"] for r in rows)
    paras, cur = [], ""
    for r in rows:
        t = re.sub(r"\s+(?:\d{1,2})$", "", r["text"].strip())  # 范文里的脚注序号
        if cur and r["x0"] > left + 10:
            paras.append(cur)
            cur = ""
        if cur.endswith("-"):
            cur += t
        else:
            cur += (" " if cur else "") + t
    if cur:
        paras.append(cur)
    return chr(10).join(p.strip() for p in paras)


def _english_after(lines, k, stop, limit=160, side=None):
    rows = []
    for l in lines[k + 1 : k + 1 + limit]:
        t = l["text"].strip()
        if rows and stop.search(t):
            break
        if CJK.search(t) or len(re.findall(r"[A-Za-z]+", t)) < 3:
            continue
        if side is not None and l["x0"] > side:
            continue
        rows.append(l)
    return rows


def parse_references(lines):
    """作文参考范文、翻译参考译文（英文）：找 "参考范文""参考译文" 标题，往后收英文行。取不到就不给"""
    refs = {}
    for key, head, stop, minwords in (
        ("translation", re.compile(r"参考译文"), re.compile(r"译点|解析|精析|难词|词汇|点评|亮点|句型"), 30),
        ("writing", re.compile(r"参考范文|范文点评|参考作文"), re.compile(r"范文译文|译文|亮点|词汇|句型|参考译文"), 80),
    ):
        for k, l in enumerate(lines):
            if head.search(l["text"]) and len(l["text"]) < 30:
                width = max(x["x1"] for x in lines[max(0, k - 5) : k + 40])
                rows = _english_after(lines, k, stop, side=300 if key == "writing" and width > 420 else None)
                text = _paragraphs(rows) if rows else ""
                if len(text.split()) >= minwords:
                    refs[key] = text
                    break
    return refs
