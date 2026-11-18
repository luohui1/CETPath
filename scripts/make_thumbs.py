"""
给每套试卷生成第一页的缩略图 public/papers/pdf/<id>.thumb.jpg（宽 360 像素），真题列表和首页当封面用。
已有且比 PDF 新的跳过。

用法：python scripts/make_thumbs.py [试卷 id ...]
"""

import glob
import os
import sys

import fitz

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF_DIR = os.path.join(ROOT, "public", "papers", "pdf")
WIDTH = 360


def make(pid: str) -> str:
    pdf = os.path.join(PDF_DIR, f"{pid}.pdf")
    out = os.path.join(PDF_DIR, f"{pid}.thumb.jpg")
    if not os.path.exists(pdf):
        return "没有 PDF"
    if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(pdf):
        return "已有"
    doc = fitz.open(pdf)
    page = doc[0]
    zoom = WIDTH / page.rect.width
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csGRAY, alpha=False)
    pix.save(out, jpg_quality=82)
    return f"{pix.width}×{pix.height}"


def main(ids: list[str]):
    if not ids:
        ids = sorted(os.path.basename(f)[:-5] for f in glob.glob(os.path.join(ROOT, "public", "papers", "*.json")) if not f.endswith("index.json"))
    for pid in ids:
        print(f"{pid:24} {make(pid)}")


if __name__ == "__main__":
    main(sys.argv[1:])
