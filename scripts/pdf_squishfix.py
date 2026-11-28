"""修复早期二值化扫描 PDF 的横向压缩变形（cm 矩阵宽度被缩窄、图像本身与页框未变形）。

用法：
  python -I scripts/pdf_squishfix.py scan [id ...]     只检查哪些 PDF 存在压缩页
  python -I scripts/pdf_squishfix.py apply [id ...]    修复、线性化、逐页校验后原子替换
"""

import json
import os
import re
import statistics
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "1")
import fitz  # noqa: E402
import numpy as np  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PDF_DIR = ROOT / "public" / "papers" / "pdf"

STREAM_RE = re.compile(
    r"^\s*q\s+[-+]?[\d.]+\s+0\s+0\s+[-+]?[\d.]+\s+[-+]?[\d.]+\s+[-+]?[\d.]+\s+cm\s+(/fzImg\d+)\s+Do\s+Q\s*$"
)


def detect_squished_pages(doc: fitz.Document) -> list[dict]:
    """返回存在横向压缩的单图扫描页信息列表。"""
    hits = []
    for i, page in enumerate(doc):
        if len(page.get_text("words")) != 0:
            continue
        imgs = page.get_images(full=True)
        if len(imgs) != 1:
            continue
        xref, _, iw, ih = imgs[0][0], imgs[0][1], imgs[0][2], imgs[0][3]
        if iw <= 0 or ih <= 0 or page.rect.width <= 0 or page.rect.height <= 0:
            continue
        img_ar = iw / ih
        page_ar = page.rect.width / page.rect.height
        if abs(img_ar - page_ar) / page_ar > 0.03:
            continue
        rects = page.get_image_rects(xref)
        if not rects:
            continue
        ir = rects[0]
        if ir.width >= page.rect.width * 0.95:
            continue
        cxs = page.get_contents()
        matched_cx = []
        for cx in cxs:
            stream = doc.xref_stream(cx).decode("latin1", errors="replace")
            m = STREAM_RE.match(stream)
            if m:
                matched_cx.append((cx, m.group(1)))
        hits.append(
            {
                "page": i + 1,
                "ir": (round(ir.x0, 2), round(ir.y0, 2), round(ir.x1, 2), round(ir.y1, 2)),
                "rect": (round(page.rect.width, 2), round(page.rect.height, 2)),
                "streams": matched_cx,
            }
        )
    return hits


def word_ink_median(page: fitz.Page, pg_w: dict) -> float | None:
    """计算 >=3 字母单词框内墨迹像素占比的中位数；词数不足 10 返回 None。"""
    ws = pg_w.get("w", [])
    words3 = [t for t in ws if len(t[0]) >= 3 and re.match(r"[A-Za-z]{3,}", t[0])]
    if len(words3) < 10:
        return None
    pix = page.get_pixmap(matrix=fitz.Matrix(1.0, 1.0), colorspace=fitz.csGRAY)
    ink = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width) < 160
    k = page.rect.width / pg_w["width"]
    ds = []
    for t in words3:
        x0, y0, x1, y1 = (int(round(v * k)) for v in t[1:5])
        x0, x1 = max(0, x0), min(ink.shape[1], x1)
        y0, y1 = max(0, y0), min(ink.shape[0], y1)
        if x1 > x0 and y1 > y0:
            ds.append(float(ink[y0:y1, x0:x1].mean()))
    return statistics.median(ds) if ds else 0.0


def repair_pdf(pdf_path: Path) -> str:
    pid = pdf_path.stem
    doc = fitz.open(str(pdf_path))
    orig_pages = len(doc)
    hits = detect_squished_pages(doc)
    if not hits:
        doc.close()
        return "无需修复"

    for h in hits:
        if not h["streams"]:
            doc.close()
            raise RuntimeError(f"{pid} 第 {h['page']} 页内容流未匹配预期格式，停止替换")

    fixed_pages = 0
    for h in hits:
        page = doc[h["page"] - 1]
        pw, ph = page.rect.width, page.rect.height
        for cx, img_name in h["streams"]:
            new_stream = f"q\n{pw:g} 0 0 {ph:g} 0 0 cm\n{img_name} Do\nQ\n"
            doc.update_stream(cx, new_stream.encode("latin1"))
        fixed_pages += 1

    fd, tmp_name = tempfile.mkstemp(suffix=".pdf", dir=pdf_path.parent)
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        doc.save(str(tmp_path), linear=True, deflate=True, garbage=3)
        doc.close()

        out = fitz.open(str(tmp_path))
        try:
            if not out.is_fast_webaccess:
                raise RuntimeError(f"{pid}: 线性化校验失败")
            if len(out) != orig_pages:
                raise RuntimeError(f"{pid}: 页数变化 {orig_pages} -> {len(out)}")

            for pi, p in enumerate(out):
                r = p.rect
                imgs = p.get_images(full=True)
                if len(imgs) != 1:
                    raise RuntimeError(f"{pid} 第 {pi + 1} 页图像数量异常: {len(imgs)}")
                rects = p.get_image_rects(imgs[0][0])
                if not rects:
                    raise RuntimeError(f"{pid} 第 {pi + 1} 页图像未放置")
                ir = rects[0]
                if (
                    abs(ir.x0 - r.x0) > 0.5
                    or abs(ir.y0 - r.y0) > 0.5
                    or abs(ir.x1 - r.x1) > 0.5
                    or abs(ir.y1 - r.y1) > 0.5
                ):
                    raise RuntimeError(f"{pid} 第 {pi + 1} 页图像框未对齐页框: {ir} != {r}")

            words_path = PDF_DIR / f"{pid}.words.json"
            min_ink = None
            if words_path.exists():
                w_pages = json.loads(words_path.read_text("utf-8"))["pages"]
                for pi, p in enumerate(out):
                    if pi >= len(w_pages):
                        continue
                    sc = word_ink_median(p, w_pages[pi])
                    if sc is not None:
                        if sc < 0.15:
                            raise RuntimeError(f"{pid} 第 {pi + 1} 页词框墨迹占比过低: {sc:.3f}")
                        min_ink = sc if min_ink is None else min(min_ink, sc)
        finally:
            out.close()

        os.replace(tmp_path, pdf_path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink()

    ink_note = f"，最低页词框墨迹 {min_ink:.3f}" if min_ink is not None else ""
    return f"已修复 {fixed_pages}/{orig_pages} 页并线性化{ink_note}"


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    fitz.TOOLS.mupdf_display_errors(False)

    cmd = sys.argv[1] if len(sys.argv) > 1 else "scan"
    if cmd not in ("scan", "apply"):
        print("用法: python -I scripts/pdf_squishfix.py [scan|apply] [id前缀 ...]")
        return 2
    prefixes = sys.argv[2:]
    files = sorted(PDF_DIR.glob("*.pdf"))
    if prefixes:
        files = [f for f in files if any(f.stem.startswith(p) for p in prefixes)]

    affected = 0
    for f in files:
        if cmd == "scan":
            doc = fitz.open(str(f))
            hits = detect_squished_pages(doc)
            total = len(doc)
            doc.close()
            if hits:
                affected += 1
                pages = [h["page"] for h in hits]
                matched = sum(1 for h in hits if h["streams"])
                print(f"SQUISHED {f.stem}: {len(hits)}/{total} 页 {pages} (流匹配 {matched}/{len(hits)})")
        else:
            doc = fitz.open(str(f))
            hits = detect_squished_pages(doc)
            doc.close()
            if not hits:
                continue
            affected += 1
            msg = repair_pdf(f)
            print(f"{f.stem:20s} {msg}", flush=True)

    print(f"共扫描 {len(files)} 个 PDF，{'发现' if cmd == 'scan' else '处理'} {affected} 个压缩 PDF")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
