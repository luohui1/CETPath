"""检查一份真题 PDF 能不能直接导入：有没有文字层、文字是不是乱码、像哪种考试。

用法：npm run inspect:pdf -- 文件.pdf [更多文件.pdf ...]

结论分三种：
  可以导入     有正常的文字层（原生文字，或扫描件自带的 OCR 文字）
  文字层乱码   能选中文字但都是乱码（字体没有编码表），要用 Word 版或先 OCR
  扫描件       整页是图片，要先 OCR
"""
import re
import sys
from pathlib import Path

import fitz

# 认得出的考试和部分标题
EXAMS = [
    ("考研英语（一）", re.compile(r"英语[（(]?[一1][）)]|Section I\s+Use of English")),
    ("考研英语（二）", re.compile(r"英语[（(]?[二2][）)]")),
    ("六级", re.compile(r"六级|CET-?6|Band Six", re.I)),
    ("四级", re.compile(r"四级|CET-?4|Band Four", re.I)),
]
PARTS = re.compile(r"Part\s+(?:I|II|III|IV)\s+[A-Z][a-z]+|Section\s+(?:I|II|III)\s+[A-Z][a-z]+(?:\s+[A-Za-z]+)?")


def page_quality(text):
    """英文单词占全部字符的比例：正常页面在一半以上，乱码页面很低"""
    text = text.strip()
    if len(text) < 50:
        return "none"
    letters = sum(len(w) for w in re.findall(r"[A-Za-z]{2,}", text))
    han = len(re.findall(r"[一-鿿]", text))
    return "ok" if (letters + han) / len(text) > 0.45 else "garbled"


def pdf_quality(path, sample=4):
    """整份 PDF 的结论：抽前几页（跳过封面），看文字层的情况"""
    try:
        doc = fitz.open(path)
    except Exception as e:
        return {"error": str(e)}
    pages = [doc[i] for i in range(min(sample, len(doc)))]
    kinds = [page_quality(p.get_text("text")) for p in pages]
    text = "ok" if kinds.count("ok") >= max(1, len(kinds) // 2) else "garbled" if "garbled" in kinds else "none"
    return {"pages": len(doc), "text": text}


VERDICT = {"ok": "可以导入", "garbled": "文字层乱码，要用 Word 版或先 OCR", "none": "扫描件，要先 OCR"}


def inspect(path):
    info = pdf_quality(path)
    print(f"\n{path}")
    if "error" in info:
        print(f"  打不开：{info['error']}")
        return
    doc = fitz.open(path)
    full = "\n".join(p.get_text("text") for p in doc)
    exams = [name for name, pat in EXAMS if pat.search(full)]
    years = sorted(set(re.findall(r"(20\d\d)\s*年", full)))
    parts = list(dict.fromkeys(re.sub(r"\s+", " ", m) for m in PARTS.findall(full)))
    print(f"  {info['pages']} 页 · {VERDICT[info['text']]}")
    for i, p in enumerate(doc):
        t = p.get_text("text")
        print(f"    第 {i + 1} 页：{len(t.strip())} 字，{len(p.get_images())} 张图，{ {'ok': '正常', 'garbled': '乱码', 'none': '无文字'}[page_quality(t)] }")
    if info["text"] == "ok":
        print(f"  像是：{'、'.join(exams) or '认不出'}；年份：{'、'.join(years) or '没写'}")
        print(f"  找到的部分标题：{'、'.join(parts) or '没有（导入时要手动定位）'}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    fitz.TOOLS.mupdf_display_errors(False)  # 资料包里的 PDF 常有小错误，不影响读取
    if len(sys.argv) < 2:
        print(__doc__)
    for arg in sys.argv[1:]:
        inspect(Path(arg))
