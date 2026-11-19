"""行中间的题号（选词填空、完形文章里的 ___30___）：box 按 PDF 里题号数字的真实位置重新对一遍。

扫描卷的文字层是 OCR 的，这类题号的 box 常常偏到空位一头，圆圈就对不上题号。
题号印在空位下划线正中，所以把页面渲染成图，在 box 那一行底下找下划线（一长段横着的黑像素），
把 box 挪到下划线中间（宽度不变）。
  python3 scripts/fix_inline_boxes.py [试卷id ...]   # 不给就跑全部；--dry 只打印
"""
import glob, json, os, sys
import numpy as np
import pymupdf as fitz

Z = 3  # 渲染倍数

ROOT = os.path.join(os.path.dirname(__file__), "..", "public", "papers")


_cache: dict = {}


def img(doc, page: int):
    k = (doc.name, page)
    if k not in _cache:
        _cache.clear()
        pix = doc[page - 1].get_pixmap(matrix=fitz.Matrix(Z, Z), colorspace=fitz.csGRAY)
        _cache[k] = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width)
    return _cache[k]


def has_text(pg, num: int, box) -> bool:
    cy = (box[1] + box[3]) / 2
    return any(abs((r.y0 + r.y1) / 2 - cy) < 5 and r.x0 < box[2] + 2 and r.x1 > box[0] - 2 for r in pg.search_for(str(num)))


def inline(page: dict, box) -> bool:
    """同一行题号左边还有字（和前端 midLine 一样）"""
    cy = (box[1] + box[3]) / 2
    return any(w[3] <= box[0] + 0.5 and w[2] <= cy <= w[4] for w in page["w"])


def underline(a, box):
    """box 那一行底下最像下划线的一段横线（pt 坐标）；离 box 中心最近、至少 15pt 长"""
    x0, x1 = int((box[0] - 45) * Z), int((box[2] + 45) * Z)
    x0 = max(0, x0)
    cx = (box[0] + box[2]) / 2
    best = None
    for y in range(int((box[3] - 2) * Z), int((box[3] + 5) * Z)):
        if y >= a.shape[0]:
            break
        row = a[y, x0:x1] < 150
        # 连成段（允许 2px 小断口）
        xs = np.flatnonzero(row)
        if not len(xs):
            continue
        cuts = np.flatnonzero(np.diff(xs) > 3)
        for seg in np.split(xs, cuts + 1):
            l, r = (seg[0] + x0) / Z, (seg[-1] + x0) / Z
            if r - l < 15 or r - l > 120:
                continue
            d = 0 if l <= cx <= r else min(abs(cx - l), abs(cx - r))
            if d < 12 and (best is None or (d, -(r - l)) < best[0]):
                best = ((d, -(r - l)), (l, r))
    return best and best[1]


def fix(pid: str, dry: bool) -> int:
    path = os.path.join(ROOT, f"{pid}.json")
    pdf = os.path.join(ROOT, "pdf", f"{pid}.pdf")
    if not os.path.exists(pdf):
        return 0
    paper = json.load(open(path, encoding="utf-8"))
    doc = fitz.open(pdf)
    words = json.load(open(os.path.join(ROOT, "pdf", f"{pid}.words.json"), encoding="utf-8"))
    words = words["pages"] if isinstance(words, dict) else words
    n = 0
    for s in paper["sections"]:
        for g in s["groups"]:
            for q in g["questions"]:
                box, page = q.get("box"), q.get("page")
                if not (q.get("options") and box and page) or not inline(words[page - 1], box):
                    continue  # 页边的题号（"46."）不动
                if has_text(doc[page - 1], q["number"], box):
                    continue  # 文字版 PDF：题号本身就在文字层里，box 是准的
                run = underline(img(doc, page), box)
                if not run:
                    continue
                mid, half = (run[0] + run[1]) / 2, (box[2] - box[0]) / 2
                new = [round(float(mid - half), 1), box[1], round(float(mid + half), 1), box[3]]
                if abs(new[0] - box[0]) > 2:
                    print(pid, q["number"], box, "->", new)
                    q["box"] = new
                    n += 1
    if n and not dry:
        json.dump(paper, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return n


if __name__ == "__main__":
    dry = "--dry" in sys.argv
    ids = [a for a in sys.argv[1:] if not a.startswith("--")] or sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(ROOT, "*.json")))
    total = sum(fix(i, dry) for i in ids)
    print("改了", total, "处")
