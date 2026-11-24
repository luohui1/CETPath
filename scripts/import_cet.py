"""导入四六级真题（2015 年以后的历年真题）。

来源：真题/四级/<年月>/、真题/六级/<年月>/ 里的真题 PDF、解析 PDF 和听力 MP3
（目录和文件名见 真题/清单.md，由 npm run organize:cet 整理）。
输出：
  public/papers/<id>.json                试卷（题目、答案、解析、在原卷上的位置、听力分段）
  public/papers/pdf/<id>.pdf             原卷（去掉卖家二维码、店铺水印；没有要去的就是硬链接）
  public/papers/pdf/<id>.words.json      每页可点击单词的坐标和句子
  public/audio/<id>.mp3                  听力录音（硬链接）
  data/cache/cet-ocr/                    解析 PDF 里扫描页的识别结果（缓存，可以删）

用法：
  python -I scripts/import_cet.py cet4-2025-12-1        导入一套
  python -I scripts/import_cet.py cet6-2025-12-1 cet6-2025-12-2
  python -I scripts/import_cet.py --all                 全部能导的都导，最后列出每套的状态
  python -I scripts/import_cet.py --list                只列出每套有哪些文件、能不能导
试卷 id 形如 cet4-2025-12-1（四级、2025 年 12 月、第 1 套）。
导完运行 npm run check:papers 和 npm run audit:explain（python -I scripts/explain_audit.py，解析截断、页脚、串题校验）。
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import fitz

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cet_ocr  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "真题"
PAPERS = ROOT / "public/papers"
PDF_DIR = PAPERS / "pdf"
AUDIO_DIR = ROOT / "public/audio"

LEVELS = {"四级": "cet4", "六级": "cet6"}
EXAM_NAME = {"cet4": "四级", "cet6": "六级"}
DURATION = {"cet4": 125, "cet6": 130}


def paper_title(exam, year, month, set_no):
    """试卷标题，和常见真题目录一个写法："2024年12月四级真题(第1套)"；2020 年 7 月那场只有一套组合卷"""
    tail = "组合卷" if (year, month) == (2020, 7) else f"第{set_no}套"
    return f"{year}年{month}月{EXAM_NAME[exam]}真题({tail})"

NAME = re.compile(
    r"^(\d{4})年(\d{2})月(四级|六级)(第(\d)套|第(\d)、(\d)套|全(\d)套|各套通用)-(真题|解析|听力)(?:（(\d)）)?\.(pdf|mp3)$"
)
KIND = {"真题": "paper", "解析": "answers", "听力": "audio"}


# ---------- 找文件 ----------

def discover():
    """扫描 真题/，返回 {试卷 id: 信息}。
    文件名有几种特殊写法：
      ...第1套-真题（2）.pdf    其实是第 2 套（（3）是第 3 套），清单里漏了
      ...第2、3套-真题.pdf      第 2、3 套合在一个文件里（shared = True）
      ...全1套-真题.pdf         整场只有一套
      ...各套通用-听力.mp3      整场共用一份听力"""
    sets = {}
    for level, exam in LEVELS.items():
        for sitting in sorted((LIB / level).glob("*年*月")):
            m = re.match(r"(\d{4})年(\d{2})月", sitting.name)
            year, month = int(m.group(1)), int(m.group(2))
            common_audio = None
            found = {}  # (套号, kind) -> (路径, 合并文件)
            for f in sorted(sitting.iterdir()):
                m = NAME.match(f.name)
                if not m:
                    continue
                kind = KIND[m.group(9)]
                if m.group(4) == "各套通用":
                    common_audio = f
                    continue
                if m.group(5):
                    nos = [int(m.group(10) or m.group(5))]
                elif m.group(6):
                    nos = [int(m.group(6)), int(m.group(7))]
                else:
                    nos = [1]
                for n in nos:
                    # 同一套有两个同类文件时，不带（2）（3）的优先；单独一套的文件比两套合在一起的优先
                    old = found.get((n, kind))
                    if old is None or (not m.group(10) and not (len(nos) > 1 and not old[1])):
                        found[(n, kind)] = (f, nos if len(nos) > 1 else None)
            for n in sorted({k[0] for k in found}):
                sid = f"{exam}-{year}-{month:02d}-{n}"
                info = {"id": sid, "exam": exam, "year": year, "month": month, "set": n, "dir": sitting, "shared": False}
                for kind in ("paper", "answers", "audio"):
                    if (n, kind) in found:
                        info[kind], shared = found[(n, kind)]
                        # 卷面是两套合在一起的（只有后半份）：跳过。解析是合在一起的、卷面单独有一份完整的：照常导入，
                        # 不是合并文件里第一套的，不取参考范文/译文（解析里排在前面的是前一套的）
                        if shared and kind == "paper":
                            info["shared"] = True
                        if shared and kind == "answers" and n != shared[0]:
                            info["answers_rest"] = True
                if "audio" not in info and common_audio:
                    info["audio"] = common_audio
                    info["audio_common"] = True
                sets[sid] = info
    # 文件名里的（2）（3）对调了的解析：按阅读解析引用的英文在哪份卷面上找得到来认（真题/ 里的文件名不改）
    for sid, name in ANSWERS_OVERRIDE.items():
        if sid in sets:
            f = sets[sid]["dir"] / name
            if f.exists():
                sets[sid]["answers"] = f
    return sets


# 解析（2）其实是第 3 套的（只有阅读，30 题；和第 3 套卷面引文重合 90%/99%，和第 2 套只有 40%），解析（3）是第 2 套的（重合 82%/100%）
ANSWERS_OVERRIDE = {
    "cet4-2017-06-2": "2017年06月四级第1套-解析（3）.pdf",
    "cet4-2017-06-3": "2017年06月四级第1套-解析（2）.pdf",
    "cet4-2018-06-2": "2018年06月四级第1套-解析（3）.pdf",
    "cet4-2018-06-3": "2018年06月四级第1套-解析（2）.pdf",
}

# 题号认错了位置的（对过卷面图）：{套: {题号: (页, [x0, y0, x1, y1])}}
# 第 3 套卷面印了"Part II Listening Comprehension (30 minutes)"、没印听力题，选词填空的空位"30"在扫描件上没认出来时，
# 第 30 题会被认到这行的 30 上（scripts/share_listening.py 接听力时会把这段去掉，题号位置不对就接不上）
NUMBER_FIX = {
    "cet4-2017-06-3": {30: (1, [365.4, 760.8, 379.4, 777.8])},
    "cet4-2019-12-3": {30: (1, [425.6, 528.2, 439.6, 541.6])},
    "cet4-2021-06-3": {30: (1, [98.9, 572.7, 115.9, 587.2])},
    "cet4-2023-12-3": {30: (1, [298.5, 605.7, 310.0, 618.4])},
    "cet6-2017-06-3": {30: (1, [169.2, 487.6, 178.4, 500.5])},
    "cet6-2017-12-3": {30: (1, [188.7, 496.3, 198.9, 507.3])},
    "cet6-2020-12-3": {30: (1, [74.7, 499.9, 88.7, 512.9])},
}


# ---------- 原卷 PDF：去广告、单词坐标 ----------

# 卖家加在卷子上的文字：店铺名、扫码引流
AD_TEXT = ["淘宝店铺", "掌柜旺旺", "光速考研", "扫码获音频", "扫码看详解", "五分打印", "首单免费"]
# 卖家二维码（音频、详解、打印店）是 396×399 或 400×400 的小图；原卷里的公式、下划线小图不是这个尺寸
QR_SIZES = {(396, 399), (400, 400)}


# 扫描页的清晰度：平板（2 倍屏、页宽约 900 CSS 像素）放到 100% 要约 220dpi，150% 约 300dpi，200% 约 400dpi。
# 原件够高的留到 360dpi（放到 170% 左右还是 1:1）；再高解码太慢、太占内存（pdf.js 要把整页图解成位图）
SCAN_DPI = 360
SCAN_QUALITY = 78
MIN_SIDE = 1000  # 比这小的图不是整页扫描（插图、公式），不动


def levels(gray):
    """扫描页洗白：纸色拉到纯白、文字拉到接近纯黑，中间灰度保留，笔画边缘还是平滑的"""
    import numpy as np

    sample = gray[::7, ::7]
    black = float(np.percentile(sample, 0.5))
    paper = float(np.percentile(sample, 60))
    if paper - black < 40 or black > 120:
        # 几乎是一张白纸（有的 PDF 字是另外画上去的，底图只是空白页或浅色底纹）、几乎全黑、或者根本没有深色笔画：不调。
        # 按下面的算法，纯白图的黑点、白点都在 255 附近，会被整张拉成全黑盖住上面的字；
        # 浅色图的白点会被推到 255 以上，纸色反而压暗
        return gray
    white = max(paper - 12, black + 60)  # 页面大部分是纸
    lut = np.clip((np.arange(256) - black) * 255.0 / (white - black), 0, 255)
    lut = 255 * (lut / 255) ** 1.25  # 稍微压暗中间调，笔画更实
    return lut.astype(np.uint8)[gray]


def shrink_images(doc):
    """
    扫描页高清化：按原件分辨率重做，最多 SCAN_DPI（原件更高的按面积缩小，黑白二值图也变成平滑的灰度；不到的保持原样），
    黑白扫描存灰度、洗白背景再轻微锐化，JPEG 质量 SCAN_QUALITY。点词的坐标是 PDF 点，不受影响。返回有没有改动
    """
    import numpy as np

    done, changed = set(), False
    for page in doc:
        for img in page.get_images(full=True):
            xref, smask, w, h = img[0], img[1], img[2], img[3]
            if xref in done or max(w, h) < MIN_SIDE:
                continue
            done.add(xref)
            rects = page.get_image_rects(xref)
            shown = max((r.width for r in rects), default=page.rect.width) or page.rect.width
            dpi = w / (shown / 72)
            try:
                opaque = True
                if smask:
                    mask = fitz.Pixmap(doc, smask)
                    opaque = mask.samples.count(255) == len(mask.samples)
                    if not opaque:
                        continue  # 真有透明度的图不动（缩小后遮罩对不上，页面会缺一块）
                pix = fitz.Pixmap(doc, xref)
                if pix.alpha:
                    pix = fitz.Pixmap(pix, 0)
                if pix.colorspace is None or pix.colorspace.n not in (1, 3):
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                small = pix
                if dpi > SCAN_DPI * 1.05:
                    k = SCAN_DPI / dpi
                    small = fitz.Pixmap(pix, max(1, round(w * k)), max(1, round(h * k)), None)
                if small.n == 3:
                    # 黑白扫描件（三个颜色通道几乎一样）存成灰度，体积小很多
                    a = np.frombuffer(small.samples, dtype=np.uint8).reshape(-1, 3)[::37].astype(np.int16)
                    if np.abs(a[:, 0] - a[:, 1]).mean() < 6 and np.abs(a[:, 1] - a[:, 2]).mean() < 6:
                        small = fitz.Pixmap(fitz.csGRAY, small)
                if small.n == 1:
                    from PIL import Image, ImageFilter

                    g = np.frombuffer(small.samples, dtype=np.uint8).reshape(small.height, small.stride)[:, : small.width]
                    # 洗白之后轻微锐化：缩小和 JPEG 都会把笔画边缘弄软
                    sharp = Image.fromarray(np.ascontiguousarray(levels(g)), "L").filter(ImageFilter.UnsharpMask(radius=1.2, percent=80, threshold=3))
                    small = fitz.Pixmap(fitz.csGRAY, small.width, small.height, sharp.tobytes(), False)
                # 直接改这个图像对象的数据和尺寸（replace_image 会多留一份旧图）
                doc.update_stream(xref, small.tobytes("jpeg", jpg_quality=SCAN_QUALITY), compress=False)
                for key, val in (("Width", small.width), ("Height", small.height), ("BitsPerComponent", 8), ("Filter", "/DCTDecode"),
                                 ("ColorSpace", "/DeviceGray" if small.n == 1 else "/DeviceRGB"), ("DecodeParms", "null"), ("Decode", "null"), ("ImageMask", "null")):
                    doc.xref_set_key(xref, key, str(val))
                if smask and opaque:
                    doc.xref_set_key(xref, "SMask", "null")  # 全不透明的遮罩，去掉
                changed = True
            except Exception:
                continue  # 个别图片格式特殊就不动它
    return changed


def clean_pdf(src, dst):
    """去掉卖家的二维码和店铺水印；没有要去的就硬链接，省空间"""
    doc = fitz.open(src)
    changed = False
    for page in doc:
        marks, qrs = [], []
        for im in page.get_image_info(xrefs=True):
            r = fitz.Rect(im["bbox"])
            if (im["width"], im["height"]) in QR_SIZES and r.width <= 140 and r.height <= 140 and im["xref"]:
                page.delete_image(im["xref"])
                qrs.append(r)
                changed = True
        for kw in AD_TEXT:
            for r in page.search_for(kw):
                marks.append(r + (-1, -1, 1, 1))
        for kw in ("音频", "音 频", "详解"):
            # 二维码下面的小字
            for r in page.search_for(kw):
                if any(r.intersects(q + (-30, -10, 30, 45)) for q in qrs):
                    marks.append(r + (-1, -1, 1, 1))
        for r in marks:
            # 店铺文字常常是看不见的文字层，只删文字、不涂白，免得盖掉卷面上的字
            page.add_redact_annot(r, fill=False)
        if marks:
            page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)
            changed = True
    if shrink_images(doc):
        changed = True
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        dst.unlink()
    if changed:
        doc.save(dst, garbage=4, deflate=True, linear=True)  # 线性化：线上边下边画，见 scripts/linearize_pdfs.py
        return fitz.open(dst), True
    doc.close()
    try:
        os.link(src, dst)
    except OSError:
        shutil.copyfile(src, dst)
    return fitz.open(dst), False


TOKEN = re.compile(r"[A-Za-z][A-Za-z'’]*(?:-[A-Za-z]+)*")
OPTION = re.compile(r"(?<![A-Za-z])[A-O]\)")

# 原卷文字层坏了的（扫描件、乱码、叠字、漏行）：整卷用 PaddleOCR 识别过的，结果在这里（scripts/cet_ocr_paddle.py --papers）。
# 有识别结果的原卷，定位、词库、可点击单词都用识别结果，不用文字层
PAPER_OCR = ROOT / "data/cache/cet-ocr-paper"
_paper_ocr = {"key": None, "pages": None}


def use_paper_ocr(pdf):
    """导入某一套之前调用：这份原卷有识别结果就载入，之后 words_of 都用它；没有就清空"""
    p = PAPER_OCR / (Path(pdf).stem + ".json")
    _paper_ocr["pages"] = {int(k): v for k, v in json.loads(p.read_text("utf-8")).items()} if p.exists() else None
    return _paper_ocr["pages"] is not None


def words_of(page):
    """原卷一页的单词 [(x0, y0, x1, y1, 词, 块, 行, 序号)]：有整卷识别结果就把识别出的行按空格拆成词
    （词的横坐标按字符数在行内均分），否则用文字层（cet_ocr.get_words）"""
    pages = _paper_ocr["pages"]
    if pages is None or page.number not in pages:
        return cet_ocr.get_words(page)
    out = []
    for li, (text, x0, y0, x1, y1, _) in enumerate(pages[page.number]):
        n = max(len(text), 1)
        for wi, m in enumerate(re.finditer(r"\S+", text)):
            out.append((x0 + (x1 - x0) * m.start() / n, y0, x0 + (x1 - x0) * m.end() / n, y1, m.group(), li, 0, wi))
    return out


def page_words(page):
    """一页的可点击单词和句子：{w: [[词, x0, y0, x1, y1, 句子序号]], s: [句子]}。选项标记 A) 不算单词"""
    words, sentences, cur = [], [], []
    for x0, y0, x1, y1, text, *_ in sorted(words_of(page), key=lambda w: (round(w[1] / 3), w[0])):
        cur.append(text)
        masked = OPTION.sub(lambda m: " " * len(m.group()), text)
        for m in TOKEN.finditer(masked):
            a = x0 + (x1 - x0) * m.start() / len(text)
            b = x0 + (x1 - x0) * m.end() / len(text)
            words.append([m.group(), round(a, 1), round(y0, 1), round(b, 1), round(y1, 1), len(sentences)])
        if re.search(r"[.?!][”\"’)]?$", text) and not re.fullmatch(r"\d+\.|Mr\.|Mrs\.|Ms\.|Dr\.|U\.S\.|[A-Z]\.", text):
            sentences.append(" ".join(cur))
            cur = []
    if cur:
        sentences.append(" ".join(cur))
    return {"width": round(page.rect.width, 1), "height": round(page.rect.height, 1), "w": words, "s": sentences}


# ---------- 原卷上的定位 ----------

def row_text(row):
    out = ""
    for k, w in enumerate(row):
        if k and w[0] - row[k - 1][2] > 0.18 * max(w[3] - w[1], 4):
            out += " "
        out += w[4]
    return out


def box_of(ws):
    r = lambda v: round(v, 1)
    return [r(min(w[0] for w in ws)), r(min(w[1] for w in ws)), r(max(w[2] for w in ws)), r(max(w[3] for w in ws))]


HEADINGS = [
    ("writing", re.compile(r"^P\w{2,3}\s*\S{1,4}\s*W?Writing\b", re.I)),
    ("listening", re.compile(r"^P\w{2,3}\s*\S{1,4}\s*Listening", re.I)),
    ("reading", re.compile(r"^P\w{2,3}\s*\S{1,4}\s*Reading", re.I)),
    ("translation", re.compile(r"^P\w{2,3}\s*\S{1,4}\s*Transla(?:tion|tiom)", re.I)),
]


def dedouble(text):
    """文字层叠了两份、错开一点的标题行（"PartPart IVIV TranslTranslationation"）：相邻重复的片段合成一份"""
    return re.sub(r"([A-Za-zⅠ-Ⅻ]{2,}?)\1", r"\1", text)
GROUP = re.compile(r"^Questions?\s*(\d{1,2})\s*(?:and|to|-|–|—)\s*(\d{1,2})(?!\d)", re.I)
GROUP_KIND = [
    ("news", re.compile(r"news\s*report", re.I)),
    ("conv", re.compile(r"conversation|dialog", re.I)),
    ("rec", re.compile(r"recording|lecture|talk|speech|interview", re.I)),
    ("pass", re.compile(r"passage", re.I)),
]
NUMBERED = re.compile(r"^(\d{1,2})\s*[.．。,]")


def number_box(row, n):
    """行首 "12." 的位置：整个第一个词（"12."）或词里前面的一截（"12.A)At..."）"""
    w = row[0]
    t = w[4]
    m = re.match(r"^\d{1,2}\s*[.．。,]?", t)
    if m is None:
        return box_of([w])  # 题号认成了 "ll." 之类
    if len(t) > len(m.group()) and m.group().endswith((".", "．", "。", ",")):
        cut = w[0] + (w[2] - w[0]) * len(m.group()) / len(t)
        return box_of([(w[0], w[1], cut, w[3])])
    if t.isdigit() and len(row) > 1 and row[1][4].startswith((".", "．")):
        return box_of([w, row[1]])
    return box_of([w])


def locate(doc):
    """原卷上的定位点。返回
      sections: {writing/listening/reading/translation: (页, 框)}
      numbers:  {题号: (页, 框)}（听力、段落匹配、仔细阅读的题号；选词填空是文章里的空位）
      groups:   [{lo, hi, kind, anchor}]  听力题组
      letters:  段落匹配的段落字母 A…最后一个"""
    sections, numbers, groups = {}, {}, []
    phase, sub = None, None  # 当前在哪个部分、阅读的哪一节
    next_listen, next_read = 1, 36
    blanks, sub_page, sub_anchor = {}, {}, {}
    letters = ""
    for pi, page in enumerate(doc):
        for row in cet_ocr.group_rows(words_of(page)):
            text = row_text(row)
            for key, pat in HEADINGS:
                if key not in sections and (pat.match(text) or (text.startswith("PartPart") and pat.match(dedouble(text)))):
                    sections[key] = (pi + 1, box_of(row[:2]))
                    phase = key
                    if key != "translation":
                        sub = None  # 翻译标题之后 sub 保留：有的 PDF 页序乱，翻译页后面还接着阅读 C 的题
                    break
            else:
                if phase in (None, "writing") and "listening" not in sections and GROUP.match(text) and re.search(r"just\s*heard", text, re.I):
                    # Part II 的标题行没识别出来：看到第一个 "Questions 1 to 4 are based on…" 就算进了听力
                    sections["listening"] = (pi + 1, box_of(row[:1]))
                    phase = "listening"
                if phase == "reading":
                    m = re.match(r"^Section\s*(\S)", text, re.I)
                    if m and not re.match(r"^Section\s*[A-Za-z]{2}", text, re.I):  # 段落里以 "section of …" 开头的行不是标题
                        # 识别有时把 B 认成 8、C 认成 G：认不出字母就按顺序往下排
                        sub = {"A": "A", "B": "B", "C": "C", "8": "B", "G": "C"}.get(m.group(1).upper()) or {None: "A", "A": "B", "B": "C"}.get(sub, sub)
                        sub_page.setdefault(sub, pi + 1)
                        sub_anchor.setdefault(sub, (pi + 1, box_of(row[:2])))
                        continue
                    if sub == "B" and re.match(r"^Passage\s*One\b", text, re.I):
                        # 有的卷面漏印了 "Section C"，段落匹配之后直接是 "Passage One"
                        sub = "C"
                        sub_page.setdefault(sub, pi + 1)
                        sub_anchor.setdefault(sub, (pi + 1, box_of(row[:2])))
                        continue
                if phase == "listening":
                    # 题组标题里的 11 认成 "1l""1I"（"Questions 8 to 1l are based on…"）
                    g = GROUP.match(re.sub(r"(?<=\d)[lI](?=\s|$|[a-z])|(?<=\s)[lI](?=\d)", "1", text))
                    if g:
                        kind = next((k for k, p in GROUP_KIND if p.search(text)), "pass")
                        groups.append({"lo": int(g.group(1)), "hi": int(g.group(2)), "kind": kind, "anchor": (pi + 1, box_of(row[:1])), "label": text})
                        continue
                    # 文字层把题号里的 1 认成 l、I（"ll. A) It can…"）
                    m = NUMBERED.match(re.sub(r"^[lI|1]{1,2}(?=\s*[.．。,])", lambda x: "1" * len(x.group()), text))
                    if m and 1 <= int(m.group(1)) <= 25:
                        n = int(m.group(1))
                        top = max((k for k in numbers if k <= 25), default=0)
                        if n in numbers and n <= top and top + 1 <= 25 and top + 1 not in numbers and re.search(r"A\s*[)）]", text):
                            n = top + 1  # 已经找到更大的题号之后又出现重复的（"22." 之后又是 "20." "21."）：文字层认错了，按顺序算下一题
                        if n not in numbers:
                            numbers[n] = (pi + 1, number_box(row, n))
                elif phase == "reading" or (phase == "translation" and sub in ("B", "C")):
                    # （有的 PDF 页序是乱的：翻译那页后面又接着阅读 C 的题）
                    if sub == "A" and re.match(r"^Questions?(?![a-z])", text, re.I):
                        continue  # "Questions 26 to 35 are based on…" 这一行里的数字不是空位
                    if sub == "A":
                        # 选词填空：文章里的空位是单独的两位数字（可能带下划线、或粘着后面的字母）；漏掉的以后再补
                        for k, w in enumerate(row):
                            m = re.match(r"^[_＿]*(\d{2})[_＿]*([A-Za-z]*)$", w[4])
                            if not m or not 26 <= int(m.group(1)) <= 35 or int(m.group(1)) in blanks:
                                continue
                            nxt = row[k + 1][4].lower() if k + 1 < len(row) else ""
                            if (k == 0 and len(row) == 1) or nxt in ("million", "billion", "percent", "per", "years", "year", "%"):
                                continue
                            t = w[4]
                            a = t.index(m.group(1))
                            x0 = w[0] + (w[2] - w[0]) * a / len(t)
                            x1 = w[0] + (w[2] - w[0]) * (a + 2) / len(t)
                            blanks[int(m.group(1))] = (pi + 1, box_of([(x0, w[1], x1, w[3])]))
                    elif sub in ("B", "C"):
                        m = NUMBERED.match(text)
                        lo, hi = (36, 45) if sub == "B" else (46, 55)
                        if not m:
                            # 题号后面漏了句点（"40 Leah's interest in…"）：上一题已经找到才认
                            m2 = re.match(r"^(\d{2})\s+(?=[A-Z][a-z])", text)
                            if m2 and lo < int(m2.group(1)) <= hi and int(m2.group(1)) - 1 in numbers:
                                m = m2
                        # 题号按部分认（B 段 36–45、C 段 46–55），第一次出现的算；有的 PDF 页序是乱的，不能要求按顺序
                        if m and lo <= int(m.group(1)) <= hi and int(m.group(1)) not in numbers:
                            n = int(m.group(1))
                            numbers[n] = (pi + 1, number_box(row, n))
                        elif sub == "B" and not any(36 <= n <= 45 for n in numbers):
                            m = re.match(r"^([A-T])\s*[)）]", text)
                            if m and m.group(1) > letters[-1:]:
                                letters = m.group(1)
    # 听力里前后两题都找到了、中间这题没有（这一行印得花，"- - -24o -A7-'Fhey…"）：在两行之间找含这个题号的词
    for n in range(2, 25):
        if n in numbers or n - 1 not in numbers or n + 1 not in numbers or numbers[n - 1][0] != numbers[n + 1][0]:
            continue
        pg, ya, yb = numbers[n - 1][0], numbers[n - 1][1][3], numbers[n + 1][1][1]
        hit = next((w for w in words_of(doc[pg - 1]) if ya - 1 < w[1] < yb and re.match(rf"^\W*{n}(?!\d)", w[4])), None)
        if hit:
            numbers[n] = (pg, box_of([hit]))
    numbers.update(blanks)
    return {"sections": sections, "numbers": numbers, "groups": groups, "letters": letters, "sub_anchors": sub_anchor, "blank_pages": list(range(sub_page["A"], sub_page.get("B", sub_page["A"]) + 1)) if "A" in sub_page else []}


# ---------- 听力音频 ----------

AUDIO_CACHE = ROOT / "data/cache/cet-audio"
ORDINAL = ["One", "Two", "Three", "Four", "Five", "Six"]
GROUP_TITLE = {"news": "News Report", "conv": "Conversation", "pass": "Passage", "rec": "Recording"}


def have_ffmpeg():
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def audio_info(mp3):
    """录音时长和静音段：[(开始, 结束)]。静音检测的结果缓存起来，重导时不用再跑一遍"""
    key = AUDIO_CACHE / (re.sub(r"[^0-9A-Za-z]+", "_", f"{mp3.parent.name}_{mp3.stem}") + f"_{mp3.stat().st_size}.json")
    if key.exists():
        return json.loads(key.read_text("utf-8"))
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(mp3)], capture_output=True, text=True).stdout.strip())
    out = subprocess.run(["ffmpeg", "-nostats", "-i", str(mp3), "-af", "silencedetect=noise=-35dB:d=0.45", "-f", "null", "-"], capture_output=True, text=True, encoding="utf-8", errors="replace").stderr
    sil, start = [], None
    for line in out.splitlines():
        m = re.search(r"silence_start: (-?[\d.]+)", line)
        if m:
            start = max(0.0, float(m.group(1)))
        m = re.search(r"silence_end: ([\d.]+)", line)
        if m and start is not None:
            sil.append([round(start, 2), round(float(m.group(1)), 2)])
            start = None
    info = {"duration": round(dur, 2), "silences": sil}
    AUDIO_CACHE.mkdir(parents=True, exist_ok=True)
    key.write_text(json.dumps(info), "utf-8")
    return info


def audio_info_rms(mp3):
    """按帧能量（RMS）找静音：有的录音底噪高，作答的 15 秒里也有杂音，ffmpeg silencedetect（看单个采样的幅度）切不开句子。
    这里按 10 毫秒一帧的 RMS 算：比整份录音的底噪（第 5 百分位）高 7dB 以上算有声，间隔不到 0.3 秒的连起来，不到 0.35 秒的丢掉。
    返回和 audio_info 一样的 {"duration", "silences"}，缓存起来"""
    key = AUDIO_CACHE / (re.sub(r"[^0-9A-Za-z]+", "_", f"{mp3.parent.name}_{mp3.stem}") + f"_{mp3.stat().st_size}_rms.json")
    if key.exists():
        return json.loads(key.read_text("utf-8"))
    import numpy as np

    sr = 8000
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(mp3), "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768
    fr = x[: len(x) // 80 * 80].reshape(-1, 80)
    db = 20 * np.log10(np.sqrt((fr ** 2).mean(1)) + 1e-9)
    on = db > np.percentile(db, 5) + 7
    runs, i, n = [], 0, len(on)
    while i < n:
        if on[i]:
            j = i
            while j < n and on[j]:
                j += 1
            runs.append([i, j])
            i = j
        else:
            i += 1
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] < 30:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    speech = [(a / 100, b / 100) for a, b in merged if b - a >= 35]
    dur = n / 100
    sil, prev = [], 0.0
    for a, b in speech:
        if a - prev >= 0.45:
            sil.append([round(prev, 2), round(a, 2)])
        prev = b
    if dur - prev >= 0.45:
        sil.append([round(prev, 2), round(dur, 2)])
    info = {"duration": round(dur, 2), "silences": sil}
    AUDIO_CACHE.mkdir(parents=True, exist_ok=True)
    key.write_text(json.dumps(info), "utf-8")
    return info


def merge_silences(silences, min_len=0.35):
    """相邻两段静音之间的声音不到 min_len 秒（一个杂音、一声咳嗽）就当没有，两段连成一段：
    作答的 15 秒里有杂音时，原来会被切成几段短静音，数不出 25 个"""
    out = []
    for s, e in silences:
        if out and s - out[-1][1] < min_len:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return out


def speech_lines(silences, start, end, min_len=0.35):
    """[start, end] 之间两次静音之间的声音：每段是一"句"（按停顿切的，不一定正好是一句话）"""
    lines, prev = [], start
    for s, e in silences:
        if e <= start or s >= end:
            continue
        a, b = prev, min(s, end)
        if b - a >= min_len:
            lines.append({"start": round(a, 2), "end": round(b, 2), "text": ""})
        prev = max(prev, e)
    if end - prev >= min_len:
        lines.append({"start": round(prev, 2), "end": round(end, 2), "text": ""})
    return lines


def pauses_fit(pauses, groups):
    """作答静音的位置合理吗：同一组里相邻两题的读题间隔不超过 25 秒，一组的最后一题到下一组第一题之间要超过 25 秒"""
    k = 0
    for gi, g in enumerate(groups):
        n = g["hi"] - g["lo"] + 1
        for j in range(1, n):
            if pauses[k + j][0] - pauses[k + j - 1][1] > 25:
                return False
        k += n
        if gi + 1 < len(groups) and pauses[k][0] - pauses[k - 1][1] < 25:
            return False
    return True


def find_pauses(sil, groups, total):
    """作答静音（每道题一段，共 total 段）：从长到短试门槛，数量对得上、而且位置合理（组内读题间隔短、
    组与组之间隔着一整段材料）才算。找不到返回 []"""
    for th in (9, 8, 7, 6, 5.5, 5, 4.5):
        cand = [s_ for s_ in sil if s_[1] - s_[0] >= th]
        if len(cand) == total and pauses_fit(cand, groups):
            return cand
    return []


def build_audio(mp3, groups, pid):
    """给听力分段。返回 (audio 字段, 各题组的 audioSegment, 说明)。
    录音里每道题后面有一段约 15 秒的作答时间，一共 25 段；每个题组结束在它最后一题的作答时间开始处。
    作答时间的数量和题数对得上才给题组分段，对不上就整段录音当一段，不设题组的 audioSegment。
    先用 ffmpeg 静音检测；数不出来再把被杂音隔开的静音连起来；还不行就按帧能量重新找静音（底噪高的录音）"""
    info = audio_info(mp3)
    dur, sil = info["duration"], info["silences"]
    total = sum(g["hi"] - g["lo"] + 1 for g in groups)
    src = f"/audio/{pid}.mp3"
    pauses, used_rms = [], False
    if total and groups:
        pauses = find_pauses(sil, groups, total)
        if not pauses:
            merged = merge_silences(sil)
            pauses = find_pauses(merged, groups, total)
            if pauses:
                sil = merged
        # 句子切得太粗（每分钟不到 4 行：底噪高，静音检测只切出作答时间）：按帧能量重切
        coarse = len(speech_lines(sil, 0.0, dur)) < dur / 60 * 4
        if not pauses or coarse:
            ri = audio_info_rms(mp3)
            rsil = merge_silences(ri["silences"])
            rp = find_pauses(rsil, groups, total)
            if rp:
                pauses, sil, used_rms = rp, rsil, True
    if total and groups and len(pauses) == total:
        segs, assign, k, prev_end = [], {}, 0, 0.0
        counters = {}
        for g in groups:
            k += g["hi"] - g["lo"] + 1
            last = pauses[k - 1]
            counters[g["kind"]] = counters.get(g["kind"], 0) + 1
            n = counters[g["kind"]]
            sid = f"{g['kind']}{n}"
            lines = speech_lines(sil, prev_end, last[0])
            # 组里第 2 题起，上一题作答时间结束到本题作答时间开始之间就是读题：第一句标成 Question N
            first_idx = k - (g["hi"] - g["lo"] + 1)
            for j in range(1, g["hi"] - g["lo"] + 1):
                a, b = pauses[first_idx + j - 1][1], pauses[first_idx + j][0]
                hit = next((ln for ln in lines if ln["start"] >= a - 0.1 and ln["end"] <= b + 0.1), None)
                if hit:
                    hit["text"] = f"Question {g['lo'] + j}"
            seg = {"id": sid, "label": f"{GROUP_TITLE[g['kind']]} {ORDINAL[n - 1]}", "start": round(lines[0]["start"] if lines else prev_end, 2), "end": round(last[0], 2), "lines": lines}
            segs.append(seg)
            assign[g["lo"]] = sid
            prev_end = last[1]
        return {"src": src, "duration": dur, "segments": segs}, assign, f"听力分 {len(segs)} 段"
    lines = speech_lines(sil, 0.0, dur)
    seg = {"id": "all", "label": "全部录音", "start": 0, "end": dur, "lines": lines}
    why = "没找到 25 段位置合理的作答静音" if total else "没有听力题"
    return {"src": src, "duration": dur, "segments": [seg]}, {}, f"整段录音（{why}）"


# ---------- 组装试卷 ----------

def make_question(n, keys, answers, numbers):
    q = {"id": f"q{n}", "number": n, "options": [{"key": k, "text": ""} for k in keys]}
    a = answers.get(n)
    if a:
        q["answer"] = a["answer"]
        if a.get("explanation"):
            q["explanation"] = a["explanation"]
    if n in numbers:
        q["page"], q["box"] = numbers[n]
    return q


# 题组固定的版式（卷面上 "Questions … are based on" 那几行识别漏了时，按这个补）
TEMPLATES = {
    "cet4": [(1, 2, "news"), (3, 4, "news"), (5, 7, "news"), (8, 11, "conv"), (12, 15, "conv"), (16, 18, "pass"), (19, 21, "pass"), (22, 25, "pass")],
    "cet6": [(1, 4, "conv"), (5, 8, "conv"), (9, 11, "pass"), (12, 15, "pass"), (16, 18, "rec"), (19, 21, "rec"), (22, 25, "rec")],
}


def resolve_groups(loc, exam):
    """听力题组：卷面上找到的正好分满 1–25 就用；漏了几组但找到的都在固定版式里，就按版式补；否则 None"""
    groups = sorted(loc["groups"], key=lambda g: g["lo"])
    for g, nxt in zip(groups, groups[1:]):
        if g["lo"] < nxt["lo"] <= g["hi"]:
            g["hi"] = nxt["lo"] - 1  # 标题里的末题号认错了（"Questions 19 to 22" 其实是 19 to 21），按下一组的首题号收回来
    if [n for g in groups for n in range(g["lo"], g["hi"] + 1)] == list(range(1, 26)):
        return groups
    tpl = TEMPLATES[exam]
    by = {(g["lo"], g["hi"]): g for g in groups}
    if not set(by) <= {(a, b) for a, b, _ in tpl} or any(n not in loc["numbers"] for n in range(1, 26)):
        return None
    out = []
    for lo, hi, kind in tpl:
        g = by.get((lo, hi))
        if g is None:
            page, box = loc["numbers"][lo]
            g = {"lo": lo, "hi": hi, "kind": kind, "anchor": (page, box), "label": ""}
        out.append(g)
    return out


def build_sections(loc, answers, refs, audio_assign, groups_l=None):
    """返回 (sections, 问题列表)。没有的部分（比如第三套不列听力）就不出现"""
    sec, nums, errors = loc["sections"], loc["numbers"], []
    out = []

    def subjective(sid, label, key, ref):
        page, box = sec[key]
        q = {"id": sid, "number": 0, "label": label, "page": page, "box": box}
        if ref:
            q["reference"] = ref
        return q

    def anchor(key):
        return {"page": sec[key][0], "box": sec[key][1]}

    if "writing" in sec:
        out.append({"id": "writing", "part": "Part I", "title": "Writing", "kind": "writing", "anchor": anchor("writing"), "groups": [{"id": "w", "questions": [subjective("w1", "作文", "writing", refs.get("writing"))]}]})

    got_l = [n for n in range(1, 26) if n in nums]
    if "listening" in sec and len(got_l) >= 20:
        groups = groups_l
        if groups is None:
            errors.append(f"听力题组对不上：{sorted((g['lo'], g['hi']) for g in loc['groups'])}")
        else:
            counters, glist = {}, []
            for g in groups:
                counters[g["kind"]] = counters.get(g["kind"], 0) + 1
                k = counters[g["kind"]]
                gid = f"{g['kind']}{k}"
                gd = {"id": gid, "title": f"{GROUP_TITLE[g['kind']]} {ORDINAL[k - 1]}"}
                if g["lo"] in audio_assign:
                    gd["audioSegment"] = audio_assign[g["lo"]]
                gd["anchor"] = {"page": g["anchor"][0], "box": g["anchor"][1]}
                gd["questions"] = [make_question(n, "ABCD", answers, nums) for n in range(g["lo"], g["hi"] + 1)]
                glist.append(gd)
            out.append({"id": "listening", "part": "Part II", "title": "Listening Comprehension", "kind": "listening", "anchor": anchor("listening"), "groups": glist})
    elif "listening" in sec and got_l:
        errors.append(f"听力只定位到 {len(got_l)} 题")

    got_r = [n for n in range(26, 56) if n in nums]
    no_a = loc.get("no_banked")  # 卷面没印选词填空（"本套阅读词汇理解与第2套内容完全一样"）：只有段落匹配和仔细阅读
    if "reading" in sec and got_r:
        want_r = list(range(36, 56)) if no_a else list(range(26, 56))
        if any(n not in nums for n in want_r):
            errors.append(f"阅读只定位到 {len(got_r)}/{len(want_r)} 题，缺 {[n for n in want_r if n not in nums]}")
            return out, errors
        b_keys = "ABCDEFGHIJKLMNOPQRST"
        top = max([loc["letters"] or "K"] + [answers[n]["answer"] for n in range(36, 46) if n in answers])
        b_keys = b_keys[: b_keys.index(top) + 1]
        groups = [
            {"id": "ra", "title": "Section A · 选词填空", "questions": [make_question(n, "ABCDEFGHIJKLMNO", answers, nums) for n in range(26, 36)]},
            {"id": "rb", "title": "Section B · 段落信息匹配", "questions": [make_question(n, b_keys, answers, nums) for n in range(36, 46)]},
            {"id": "rc1", "title": "Section C · Passage One", "questions": [make_question(n, "ABCD", answers, nums) for n in range(46, 51)]},
            {"id": "rc2", "title": "Section C · Passage Two", "questions": [make_question(n, "ABCD", answers, nums) for n in range(51, 56)]},
        ]
        subs = loc.get("sub_anchors", {})

        def sub_anchor_of(key, first):
            page, box = subs[key] if key in subs else nums[first]
            return {"page": page, "box": box}

        # 阅读分成三个部分，各有自己的标题位置：选词填空 / 段落匹配 / 仔细阅读
        for sid, sub, kind, key, glist in (
            ("reading-a", "Section A", "banked", "A", [groups[0]]),
            ("reading-b", "Section B", "matching", "B", [groups[1]]),
            ("reading-c", "Section C", "reading", "C", groups[2:]),
        ):
            if no_a and key == "A":
                continue
            first = glist[0]["questions"][0]["number"]
            out.append({"id": sid, "part": "Part III", "title": "Reading Comprehension", "subtitle": sub, "kind": kind, "anchor": sub_anchor_of(key, first), "groups": glist})
    elif "reading" in sec:
        pass

    if "translation" in sec:
        out.append({"id": "translation", "part": "Part IV", "title": "Translation", "kind": "translation", "anchor": anchor("translation"), "groups": [{"id": "t", "questions": [subjective("t1", "翻译", "translation", refs.get("translation"))]}]})
    return out, errors


# ---------- 导入一套 ----------

def paper_text_ok(doc):
    """原卷有没有能用的文字层（扫描件、乱码都不行）；整卷识别过的算能用"""
    if _paper_ocr["pages"] is not None:
        return True
    pages = [cet_ocr.text_lines(doc[i]) for i in range(min(3, len(doc)))]
    return all(cet_ocr.text_ok(p) for p in pages if p) and any(pages)


RANGES = [(1, 25, "ABCD"), (26, 35, "ABCDEFGHIJKLMNO"), (36, 45, "ABCDEFGHIJKLMNOPQRST"), (46, 55, "ABCD")]


def quote_overlap(doc, answers):
    """阅读解析里引用的英文词（5 个字母以上），有多大比例能在原卷里找到。
    原卷文字层常把词粘在一起或丢掉词尾，所以去掉空格后按前 7 个字母找。
    对的解析一般在 85% 以上，拿错的只有 30% 左右；引用太少（不到 30 个词）就不判断"""
    words = {w.lower() for n in range(26, 56) if n in answers for w in re.findall(r"[A-Za-z]{5,}", answers[n].get("explanation") or "")}
    if len(words) < 30:
        return None
    text = re.sub(r"[^a-z]", "", " ".join(w[4] for p in doc for w in words_of(p)).lower())
    return sum(1 for w in words if w[:7] in text) / len(words)


def paper_bank(doc, loc):
    """原卷选词填空的词库 {字母: 词}（A–O）：在 Section A 标题之后、Section B 标题之前，行里 "A) word"。取不到返回 {}"""
    subs = loc.get("sub_anchors", {})
    if "A" not in subs:
        return {}
    (pa, ba), (pb, bb) = subs["A"], subs.get("B", (subs["A"][0] + 1, [0, 1e9, 0, 0]))
    bank = {}
    opt = re.compile(r"^([A-O0])[)）](.*)$")
    for pi in range(pa - 1, min(pb, len(doc))):
        for row in cet_ocr.group_rows(words_of(doc[pi])):
            y = min(w[1] for w in row)
            if (pi + 1 == pa and y < ba[1] - 2) or (pi + 1 == pb and y >= bb[1] - 2):
                continue  # 前面是听力题的选项
            cur = None
            for w in row:
                t = w[4].strip()
                m = opt.match(t)
                if m:
                    cur = "O" if m.group(1) == "0" else m.group(1)
                    rest = m.group(2)
                    if cur not in bank and re.fullmatch(r"[A-Za-z-]{2,}", rest or ""):
                        bank[cur] = rest
                        cur = None
                    elif cur in bank:
                        cur = None
                    continue
                if cur and cur not in bank and re.fullmatch(r"[A-Za-z-]{2,}", t):
                    bank[cur] = t
                    cur = None
    return bank


def import_set(info, ffmpeg=True, ocr=True, dry=False):
    """导入一套。返回 (状态, 说明)：状态是 "导入" 或 "跳过"；出问题就什么都不写。
    dry=True 只做检查，什么都不写，能导就返回 ("可导入", ...)"""
    import cet_answers

    sid = info["id"]
    if "paper" not in info:
        return "跳过", "缺真题卷"
    if "answers" not in info:
        return "跳过", "缺解析，没有答案"
    if info["shared"]:
        return "跳过", "第 2、3 套合在一个文件里，且只有后半份卷面"
    use_paper_ocr(info["paper"])
    doc = fitz.open(info["paper"])
    if not paper_text_ok(doc):
        return "跳过", "原卷文字层乱码或是纯图片扫描件"
    loc = locate(doc)
    nums = loc["numbers"]
    nums.update(NUMBER_FIX.get(sid, {}))
    has_l =len([n for n in range(1, 26) if n in nums]) >= 20 and "listening" in loc["sections"]
    has_r = "reading" in loc["sections"] and any(n in nums for n in range(26, 56))
    if not (has_l or has_r or loc["sections"]):
        return "跳过", "原卷里没找到任何部分标题"
    if "translation" not in loc["sections"]:
        return "跳过", "原卷里没找到 Part IV Translation 标题"
    if len(doc) >= 4 and not (has_l or has_r):
        return "跳过", "页数不少却没认出听力和阅读部分（文字层有问题）"
    if "audio" in info and not info.get("audio_common") and not has_l:
        return "跳过", "有听力录音，但原卷里没认出听力题（卷面文字层有问题）"
    if "writing" not in loc["sections"]:
        # Part I 总在第一页最前面：标题没识别出来就用第一页第一行的位置
        rows = cet_ocr.group_rows(words_of(doc[0]))
        if not rows:
            return "跳过", "原卷第一页没有文字"
        loc["sections"]["writing"] = (1, box_of(rows[0][:2]))
    # 卷面没印选词填空：第 3 套写着"本套阅读词汇理解与第2套内容完全一样，因此在本套真题中不再重复出现"，空位一个也没有
    loc["no_banked"] = has_r and not any(n in nums for n in range(26, 36)) and all(n in nums for n in range(36, 56)) and bool(
        re.search(r"词汇理解.{0,20}(?:完全一样|相同)|不再重复出现", "".join(w[4] for p in doc for w in words_of(p)))
    )
    need = [n for lo, hi, _ in RANGES for n in range(lo, hi + 1) if (lo <= 25 and has_l) or (lo >= 26 and has_r and not (loc["no_banked"] and lo == 26))]
    if not ocr and cet_answers.pages_need_ocr(info["answers"]):
        return "跳过", "解析里还有没识别的扫描页（去掉 --no-ocr 会先识别）"
    answers, problems, lines = cet_answers.parse_answers(info["answers"], bank=paper_bank(doc, loc) if has_r else None)
    # 核实过的答案更正（scripts/cet_answer_fixes.json）：用更正的答案，原始解析不可信就不要了
    for n, fix in json.loads((Path(__file__).parent / "cet_answer_fixes.json").read_text("utf-8")).get(sid, {}).items():
        answers[int(n)] = {"answer": fix["answer"]}
    missing = [n for n in need if n not in answers]
    if missing:
        return "跳过", f"答案没取全，缺 {missing}"
    for lo, hi, keys in RANGES:
        bad = [n for n in range(lo, hi + 1) if n in answers and n in need and answers[n]["answer"] not in keys]
        if bad:
            return "跳过", f"答案字母不对 {bad}"
    if has_r:
        # 选词填空每个词只能用一次：答案有重复就是取错了
        bank = [answers.get(n, {}).get("answer") for n in range(26, 36)]
        if not loc["no_banked"] and len(set(bank)) != 10:
            return "跳过", f"选词填空答案有重复，不可信：{''.join(bank)}"
        # 文件名里的（2）（3）不一定是套号：拿成别的卷子的解析时，答案全是错的
        share = quote_overlap(doc, answers)
        if share is not None and share < 0.6:
            return "跳过", f"解析和原卷对不上：阅读解析里引用的英文只有 {share:.0%} 在原卷里，可能是别的卷子的解析"
    refs = {} if info.get("answers_rest") else cet_answers.parse_references(lines)
    if has_r and not loc["no_banked"]:
        ocr_blanks(doc, info["paper"], loc, ocr)
    groups_l = resolve_groups(loc, info["exam"]) if has_l else None
    audio, assign, audio_note = None, {}, ""
    if has_l and groups_l and "audio" in info and ffmpeg and have_ffmpeg():
        audio, assign, audio_note = build_audio(info["audio"], groups_l, sid)
    sections, errors = build_sections(loc, answers, refs, assign, groups_l)
    if errors:
        return "跳过", "；".join(errors)

    if dry:
        return "可导入", f"{sum(len(g['questions']) for s_ in sections for g in s_['groups'])} 题" + (f"，{audio_note}" if audio else "")

    # 到这里能导了：写 PDF、单词、音频、试卷
    out_pdf = PDF_DIR / f"{sid}.pdf"
    cdoc, cleaned = clean_pdf(info["paper"], out_pdf)
    pages = [page_words(p) for p in cdoc]
    (PDF_DIR / f"{sid}.words.json").write_text(json.dumps({"pages": pages}, ensure_ascii=False, separators=(",", ":")), "utf-8")
    if audio:
        AUDIO_DIR.mkdir(parents=True, exist_ok=True)
        dst = AUDIO_DIR / f"{sid}.mp3"
        if dst.exists():
            dst.unlink()
        try:
            os.link(info["audio"], dst)
        except OSError:
            shutil.copyfile(info["audio"], dst)
    note = "原卷来自网络转载的扫描版（文字层是扫描识别的，个别字词可能有错），已去掉卖家二维码和店铺水印；答案和解析来自配套的解析 PDF。"
    kinds = {s["kind"] for s in sections}
    if "listening" not in kinds and "reading" not in kinds:
        note += "本套卷面只列出写作和翻译，听力和阅读与同场另一套相同。"
    elif "listening" not in kinds:
        note += "本套卷面没有列出听力，听力与同场另一套相同。"
    if loc.get("no_banked"):
        note += "本套卷面没有印选词填空（与同场另一套相同），只有段落匹配和仔细阅读。"
    if audio and info.get("audio_common"):
        note += "整场共用一份听力录音。"
    if audio and audio_note.startswith("整段"):
        note += "听力录音没能按题组分段，整段播放。"
    paper = {
        "id": sid,
        "exam": info["exam"],
        "year": info["year"],
        "month": info["month"],
        "set": info["set"],
        "title": paper_title(info["exam"], info["year"], info["month"], info["set"]),
        "label": "真题",
        "note": note,
        "durationMinutes": DURATION[info["exam"]],
        "pdf": {"src": f"/papers/pdf/{sid}.pdf", "words": f"/papers/pdf/{sid}.words.json"},
    }
    if audio:
        paper["audio"] = audio
    paper["sections"] = sections
    transcript = ""
    if audio:
        # 听力逐字稿：把解析里的听力原文对到每一行上（scripts/align_transcripts.py）。重导时录音的行是重新切的，要重新对
        try:
            import align_transcripts

            rep = align_transcripts.align_paper(paper, info["answers"], allow_ocr=ocr, workers=8)
            tot = sum(x["lines"] for x in rep["segments"])
            txt = sum(x["text"] for x in rep["segments"])
            transcript = f"，逐字稿 {100 * txt // max(tot, 1)}% 的行有文字" if tot else f"，没对逐字稿（{rep['note']}）"
        except Exception as e:  # 逐字稿出问题不影响导入
            transcript = f"，逐字稿出错（{type(e).__name__}: {e}）"
    (PAPERS / f"{sid}.json").write_text(json.dumps(paper, ensure_ascii=False, indent=2) + "\n", "utf-8")
    nq = sum(len(g["questions"]) for s in sections for g in s["groups"])
    detail = f"{nq} 题，{len(pages)} 页" + ("（已去水印）" if cleaned else "")
    if audio:
        detail += f"，{audio_note}{transcript}"
    elif has_l:
        detail += "，没有录音" if "audio" not in info else "，没装 ffmpeg，未处理录音"
    return "导入", detail


def remove_outputs(sid):
    """跳过的套：把以前导入留下的文件清掉，免得目录里留着旧的、不对的试卷。原卷 PDF 已提交进仓库，不删"""
    for f in (PAPERS / f"{sid}.json", PDF_DIR / f"{sid}.words.json", AUDIO_DIR / f"{sid}.mp3"):
        if f.exists():
            f.unlink()


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    fitz.TOOLS.mupdf_display_errors(False)
    ap = argparse.ArgumentParser(description="导入四六级真题")
    ap.add_argument("ids", nargs="*", help="试卷 id，如 cet4-2025-12-1")
    ap.add_argument("--all", action="store_true", help="导入全部")
    ap.add_argument("--list", action="store_true", help="只列出每套有哪些文件")
    ap.add_argument("--no-audio", action="store_true", help="不处理听力")
    ap.add_argument("--no-ocr", action="store_true", help="不识别扫描页，需要识别的套直接跳过")
    ap.add_argument("--dry-run", action="store_true", help="只检查每套能不能导、为什么跳过，不写任何文件（也不删旧文件）")
    ap.add_argument("--workers", type=int, default=10, help="识别扫描页用的进程数")
    args = ap.parse_args()
    sets = discover()
    if args.list:
        for sid, s in sets.items():
            have = "".join(f" {k}" for k in ("paper", "answers", "audio") if k in s)
            print(f"{sid}{'（合并文件）' if s['shared'] else ''}:{have}")
        return
    ids = list(sets) if args.all else args.ids
    if not ids:
        ap.print_help()
        return
    unknown = [i for i in ids if i not in sets]
    if unknown:
        sys.exit(f"没有这些试卷：{unknown}（用 --list 看有哪些）")
    # 先把所有要识别的扫描页（和汉字是乱码的页）一起识别掉（多进程）
    import cet_answers

    jobs = []
    for sid in ([] if args.no_ocr else ids):
        a = sets[sid].get("answers")
        if a and "paper" in sets[sid] and not sets[sid]["shared"]:
            jobs += [(str(a), i) for i in cet_answers.pages_need_ocr(a)]
    if jobs:
        print(f"要识别 {len(jobs)} 页扫描页（结果缓存在 data/cache/cet-ocr/，第一次比较慢）……", flush=True)
        cet_ocr.run_ocr(jobs, workers=args.workers, log=lambda m: print(m, flush=True))
    if not args.no_ocr:
        # 原卷文字层里漏了选词填空的空位数字：那几页也一起识别（import_set 里用到缓存）
        blank_jobs = []
        for sid in ids:
            info = sets[sid]
            if "paper" not in info or "answers" not in info or info["shared"]:
                continue
            try:
                use_paper_ocr(info["paper"])
                doc = fitz.open(info["paper"])
                if not paper_text_ok(doc):
                    continue
                loc = locate(doc)
            except Exception:
                continue
            if "reading" in loc["sections"] and any(n not in loc["numbers"] for n in range(26, 36)):
                cached = cet_ocr.load_cache(info["paper"])
                blank_jobs += [(str(info["paper"]), pg - 1) for pg in loc["blank_pages"] if pg - 1 not in cached]
        if blank_jobs:
            print(f"原卷里有 {len(blank_jobs)} 页要识别选词填空的空位……", flush=True)
            cet_ocr.run_ocr(blank_jobs, workers=args.workers, log=lambda m: print(m, flush=True))
    results = []
    for sid in ids:
        try:
            status, detail = import_set(sets[sid], ffmpeg=not args.no_audio, ocr=not args.no_ocr, dry=args.dry_run)
        except Exception as e:  # 一套出错不影响别的
            status, detail = "跳过", f"出错：{type(e).__name__}: {e}"
        if status == "跳过" and not args.dry_run:
            remove_outputs(sid)
        results.append((sid, status, detail))
        print(f"{status}  {sid}  {detail}", flush=True)
    if args.all:
        # 状态表也存一份，方便对照（--dry-run 存成 cet-import-dryrun.json）
        out = ROOT / ("data/cache/cet-import-dryrun.json" if args.dry_run else "data/cache/cet-import-status.json")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps([{"id": a, "status": b, "detail": c} for a, b, c in results], ensure_ascii=False, indent=1), "utf-8")
    done = [r for r in results if r[1] in ("导入", "可导入")]
    print(f"\n共 {len(results)} 套：{'可导入' if args.dry_run else '导入'} {len(done)} 套，跳过 {len(results) - len(done)} 套")
    if not args.dry_run:
        print("导完运行 npm run check:papers 和 npm run audit:explain（解析文本校验）")



def ocr_blanks(doc, paper_pdf, loc, allow_ocr=True):
    """文字层里没有空位数字的（扫描识别漏掉了），把选词填空那几页重新识别，在识别出的行里找 26…35"""
    missing = [n for n in range(26, 36) if n not in loc["numbers"]]
    if not missing or not loc["blank_pages"]:
        return
    # 整卷识别过的原卷：locate 已经用的是识别结果，再找一遍也是这些行
    cache = _paper_ocr["pages"] if _paper_ocr["pages"] is not None else cet_ocr.load_cache(paper_pdf)
    dirty = False
    for pg in loc["blank_pages"]:
        if pg - 1 not in cache:
            if not allow_ocr:
                return
            cache[pg - 1] = [[l["text"], round(l["x0"], 1), round(l["y0"], 1), round(l["x1"], 1), round(l["y1"], 1), round(l["score"], 2)] for l in cet_ocr.ocr_page(doc[pg - 1])]
            dirty = True
    if dirty:
        cet_ocr.save_cache(paper_pdf, cache)
    last = (0, 0.0)
    for pg in loc["blank_pages"]:
        rows = list(cache[pg - 1])
        if _paper_ocr["pages"] is not None:
            # 整卷识别过的原卷：识别里把空位数字认丢了的，再到文字层和以前本机识别的空位页里找（几份常常各丢不同的空）
            rows += [[l["text"], l["x0"], l["y0"], l["x1"], l["y1"], 1.0] for l in cet_ocr.text_lines(doc[pg - 1])]
            rows += cet_ocr.load_cache(paper_pdf).get(pg - 1, [])
        for text, x0, y0, x1, y1, _ in rows:
            if re.match(r"^\s*Questions?", text, re.I):
                continue  # "Questions 26 to 35 are based on…" 里的数字不是空位
            # 前面是数字或小数点（"3.31"）的不是空位；缩写后面的（"U.S.31"）是
            for m in re.finditer(r"(?<![\d,$%])(?<!\d\.)(2[6-9]|3[0-5])(?![\d%])", text):
                n = int(m.group(1))
                if n in loc["numbers"] or n not in missing:
                    continue
                cx = x0 + (x1 - x0) * (m.start() + 1) / max(len(text), 1)
                loc["numbers"][n] = (pg, [round(cx - 7, 1), round(y0, 1), round(cx + 7, 1), round(y1, 1)])


if __name__ == "__main__":
    main()
