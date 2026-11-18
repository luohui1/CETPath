"""扫描卷瘦身（2026-11-12）：纯文字的扫描页（8 位灰度 JPEG）改成黑白 CCITT G4，体积小 5–10 倍，文字反而更清楚。

为什么：国内直连新加坡只有每秒几十 KB，扫描卷一套 5–11MB、第一页一张图就 0.7–1.8MB，"试卷打不开"（2020 年那几套最明显）。
单词层坐标（.words.json）是 PDF 点坐标，换图不换版面，不受影响。

哪些页转：图是 8 位灰度（或彩色但三个通道几乎一样）的 JPEG、体积 > 80KB，而且"中间灰"（60–200）的像素不到 4%（带照片、灰底图表的页不转）。
每份都去重存（garbage=4：文字版卷同一个 650KB 中文字体每页嵌一份，去重后小一半以上）；去重后还 > 3MB、大头是字体的文字版卷，
整页按 300dpi 转黑白 G4 图。
阈值用 Otsu。转完逐页检查：页数不变；新图渲染出来和原图的黑像素位置基本一致（差异 < 3%，整页转图的 < 8%：矢量字边缘的抗锯齿）才替换。
原文件第一次替换前存进 BACKUP 目录。可以反复运行（已经是黑白的页跳过）。

  python -I scripts/pdf_bilevel.py check [id 前缀 ...]    只统计能省多少
  python -I scripts/pdf_bilevel.py apply [id 前缀 ...]    转换并替换
"""
import io
import json
import os
import re
import shutil
import sys
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "1")
import fitz  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PDF_DIR = ROOT / "public" / "papers" / "pdf"
BACKUP = Path(os.environ.get("PDF_BACKUP", r"D:\Flies\claude\25f93fe317e9d9a4\715290c8-ae94-40fc-a168-1c492acb0efc\pdf-original-backup"))
MID_MAX = 0.04
MIN_BYTES = 80 * 1024

sys.stdout.reconfigure(encoding="utf-8")


def otsu(a):
    hist = np.bincount(a.ravel(), minlength=256).astype(float)
    n = hist.sum()
    w = np.cumsum(hist)
    m = np.cumsum(hist * np.arange(256))
    between = (m[-1] * w / n - m) ** 2 / (w * (n - w) + 1e-9)
    return int(np.argmax(between[:250]))


def g4_strip(bw: Image.Image) -> bytes:
    """黑白图 → 单条带的 CCITT G4 原始数据（PDF 的 CCITTFaxDecode 直接能用）"""
    buf = io.BytesIO()
    bw.save(buf, "TIFF", compression="group4", strip_size=2 ** 31 - 1)
    t = Image.open(io.BytesIO(buf.getvalue()))
    offs, counts = t.tag_v2[273], t.tag_v2[279]
    if len(offs) != 1:
        raise ValueError("TIFF 不是单条带")
    data = buf.getvalue()
    return data[offs[0]: offs[0] + counts[0]]


def convert_image(doc, xref):
    """可转就返回 (新流, 宽, 高, 旧字节数)；不该转返回 None。
    灰度 JPEG；彩色 JPEG 但其实是黑白扫描（三个通道几乎一样）的也转"""
    obj = doc.xref_object(xref)
    if "/DCTDecode" not in obj or not ("/DeviceGray" in obj or "/DeviceRGB" in obj):
        return None
    raw = doc.xref_stream_raw(xref)
    if not raw or len(raw) < MIN_BYTES:
        return None
    src = Image.open(io.BytesIO(raw))
    if src.mode not in ("L", "RGB"):
        return None
    if src.mode == "RGB":
        c = np.asarray(src).astype(np.int16)
        if float(np.abs(c[..., 0] - c[..., 1]).mean() + np.abs(c[..., 1] - c[..., 2]).mean()) > 6:
            return None  # 真有颜色
    img = src.convert("L")
    a = np.asarray(img)
    mid = float(((a > 60) & (a < 200)).mean())
    if mid >= MID_MAX:
        return None
    t = otsu(a)
    bw = Image.fromarray(np.where(a > t, 255, 0).astype(np.uint8)).convert("1")
    return g4_strip(bw), img.size[0], img.size[1], len(raw), a, t


RASTER_MIN = 3 * 1024 * 1024
DPI = 300


def font_bytes(path):
    d = fitz.open(path)
    n = 0
    for x in range(1, d.xref_length()):
        try:
            if d.xref_is_stream(x) and re.search(r"/Length1|/FontFile|/Subtype\s*/(Type1C|CIDFontType0C|OpenType)", d.xref_object(x)):
                n += len(d.xref_stream_raw(x) or b"")
        except Exception:
            continue
    d.close()
    return n


def rasterize(path):
    """整份 PDF 每页按 300dpi 渲染、Otsu 转黑白、CCITT G4 存成只有一张图的页（页面大小不变）"""
    src = fitz.open(path)
    out = fitz.open()
    for page in src:
        pix = page.get_pixmap(matrix=fitz.Matrix(DPI / 72, DPI / 72), colorspace=fitz.csGRAY)
        a = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
        t = otsu(a)
        bw = Image.fromarray(np.where(a > t, 255, 0).astype(np.uint8)).convert("1")
        data = g4_strip(bw)
        np_ = out.new_page(width=page.rect.width, height=page.rect.height)
        # 先放一张占位图，再把它的流换成 G4。占位图每页尺寸不同：一样的图 PyMuPDF 会并成一个对象，
        # 那样所有页都指着同一张图、最后一页的内容会盖掉前面所有页
        ph = io.BytesIO()
        Image.new("L", (1, page.number + 1), 255).save(ph, "PNG")
        xref = np_.insert_image(np_.rect, stream=ph.getvalue())
        out.update_stream(xref, data, new=False, compress=False)
        for k, v in (("Filter", "/CCITTFaxDecode"), ("DecodeParms", f"<</K -1/Columns {pix.width}/Rows {pix.height}/BlackIs1 true>>"),
                     ("BitsPerComponent", "1"), ("ColorSpace", "/DeviceGray"), ("Width", str(pix.width)), ("Height", str(pix.height)),
                     ("Length", str(len(data))), ("SMask", "null")):
            out.xref_set_key(xref, k, v)
    src.close()
    tmp2 = Path(str(path) + ".r.pdf")
    out.save(tmp2, garbage=4, deflate=True)
    out.close()
    os.replace(tmp2, path)


def ink(pix_samples, w, h):
    a = np.frombuffer(pix_samples, dtype=np.uint8).reshape(h, w)
    return a < 128


def process(pid, apply):
    src = PDF_DIR / f"{pid}.pdf"
    doc = fitz.open(src)
    before = src.stat().st_size
    changed = 0
    saved = 0
    for page in doc:
        for im in page.get_images(full=True):
            xref = im[0]
            r = convert_image(doc, xref)
            if not r:
                continue
            data, w, h, old, a, t = r
            saved += old - len(data)
            changed += 1
            if apply:
                doc.update_stream(xref, data, new=False, compress=False)
                doc.xref_set_key(xref, "Filter", "/CCITTFaxDecode")
                doc.xref_set_key(xref, "DecodeParms", f"<</K -1/Columns {w}/Rows {h}/BlackIs1 true>>")
                doc.xref_set_key(xref, "BitsPerComponent", "1")
                doc.xref_set_key(xref, "ColorSpace", "/DeviceGray")
                doc.xref_set_key(xref, "Length", str(len(data)))
    if not apply:
        return before, before - saved, changed
    # 去重存一份（同一个 650KB 的中文字体每页嵌一份的文字版卷，去重后小一半以上，无损）
    tmp = src.with_suffix(".tmp.pdf")
    doc.save(tmp, garbage=4, deflate=True)
    doc.close()
    raster = False
    if tmp.stat().st_size > RASTER_MIN and font_bytes(tmp) > 0.6 * tmp.stat().st_size:
        # 去重后还大、大头是字体：整页按 300dpi 转黑白图（点词用的是单独的单词坐标文件，不受影响）
        rasterize(tmp)
        raster = True
    if tmp.stat().st_size >= before * 0.95:
        tmp.unlink()
        return before, before, 0
    # 核对：页数不变；每页渲染出来的黑像素和原 PDF 基本一致（整页转图时文字边缘抗锯齿有差，放宽到 8%）
    a_doc, b_doc = fitz.open(src), fitz.open(tmp)
    ok = len(a_doc) == len(b_doc)
    for i in range(len(a_doc)) if ok else []:
        pa = a_doc[i].get_pixmap(matrix=fitz.Matrix(0.6, 0.6), colorspace=fitz.csGRAY)
        pb = b_doc[i].get_pixmap(matrix=fitz.Matrix(0.6, 0.6), colorspace=fitz.csGRAY)
        if (pa.width, pa.height) != (pb.width, pb.height):
            ok = False
            break
        ia, ib = ink(pa.samples, pa.width, pa.height), ink(pb.samples, pb.width, pb.height)
        diff = float((ia != ib).mean())
        if diff > (0.08 if raster else 0.03):
            print(f"  {pid} 第 {i + 1} 页渲染差异 {diff:.1%}，不替换", flush=True)
            ok = False
            break
    a_doc.close()
    b_doc.close()
    if not ok:
        tmp.unlink()
        return before, before, 0
    BACKUP.mkdir(parents=True, exist_ok=True)
    if not (BACKUP / src.name).exists():
        shutil.copy2(src, BACKUP / src.name)
    os.replace(tmp, src)
    return before, src.stat().st_size, changed


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    pre = sys.argv[2:]
    idx = json.loads((ROOT / "public" / "papers" / "index.json").read_text("utf-8"))
    ids = [x["id"] for x in idx if not pre or any(x["id"].startswith(p) for p in pre)]
    tb = ta = 0
    for pid in ids:
        b, a, n = process(pid, cmd == "apply")
        tb += b
        ta += a
        if n:
            print(f"{pid}：{b / 1e6:.1f}MB → {a / 1e6:.1f}MB（{n} 页转黑白）", flush=True)
    print(f"合计 {tb / 1e6:.0f}MB → {ta / 1e6:.0f}MB")


if __name__ == "__main__":
    main()
