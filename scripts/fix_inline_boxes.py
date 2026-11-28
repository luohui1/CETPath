"""行中间的题号（选词填空、完形文章里的 ___30___）：box 按 PDF 里下划线与题号数字的真实像素位置校准。

原因：
- 部分扫描卷或重排 PDF 带有偏移的 HiddenHorzOCR 隐藏文字层，导致旧版 `has_text()` 误跳过或 OCR 把空位数字算偏到下划线一端；
- 另有一百余道选词填空空位恰好落在换行行首（左边没有单词），也需要在全量校准时一并识别为行内题号。

做法（216dpi 灰度渲染 + 像素连通域）：
1. 若某题属于 `banked` 题型、句中含 `___N___`、或同行左侧有词，即判定为行内空位；
2. 在题号框底边附近扫描真实下划线横段（长 14–125pt，允许 4px 断笔）；
3. 在下划线左右两端缩进范围内提取上方印刷体题号数字墨迹簇 [dl, dr]，将题号 box 精确居中贴合数字（若无明显数字簇则居中到下划线中点）。

用法：
  python -I scripts/fix_inline_boxes.py [--dry] [试卷id ...]
"""

import glob
import json
import os
import shutil
import sys
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "1")
import numpy as np  # noqa: E402
import pymupdf as fitz  # noqa: E402

Z = 3.0  # 216dpi

ROOT = Path(__file__).resolve().parent.parent
PAPERS_DIR = ROOT / "public" / "papers"
BACKUP_DIR = ROOT / "data" / "cache" / "paper-qbox-fix"

_cache: dict[tuple[str, int], np.ndarray] = {}


def page_img(doc: fitz.Document, page: int) -> np.ndarray:
    k = (doc.name, page)
    if k not in _cache:
        _cache.clear()
        pix = doc[page - 1].get_pixmap(matrix=fitz.Matrix(Z, Z), colorspace=fitz.csGRAY, alpha=False)
        _cache[k] = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width)
    return _cache[k]


def has_left_word(page: dict, box: list[float]) -> bool:
    cy = (box[1] + box[3]) / 2
    return any(w[3] <= box[0] + 0.5 and w[2] <= cy <= w[4] for w in page.get("w", []))


def is_inline_question(section_kind: str, page: dict, box: list[float], q_num: int) -> bool:
    if section_kind == "banked":
        return True
    mark = f"___{q_num}___"
    if any(mark in s for s in page.get("s", [])):
        return True
    return has_left_word(page, box)


def find_underline(a: np.ndarray, box: list[float], kz: float) -> tuple[float, float, float] | None:
    """在 box 底边附近查找真实空位下划线 (ul_l, ul_r, ul_y)，单位为 words.json 坐标系 pt。"""
    x0 = max(0, int((box[0] - 95) * kz))
    x1 = min(a.shape[1], int((box[2] + 95) * kz))
    if x1 <= x0:
        return None
    cx = (box[0] + box[2]) / 2
    y_lo = max(0, int((box[3] - 3.5) * kz))
    y_hi = min(a.shape[0], int((box[3] + 5.5) * kz))
    best = None
    for y in range(y_lo, y_hi):
        xs = np.flatnonzero(a[y, x0:x1] < 185)
        if not len(xs):
            continue
        cuts = np.flatnonzero(np.diff(xs) > 4)
        for seg in np.split(xs, cuts + 1):
            l = (int(seg[0]) + x0) / kz
            r = (int(seg[-1]) + 1 + x0) / kz
            w_pt = r - l
            if w_pt < 14.0 or w_pt > 125.0:
                continue
            d = 0.0 if l <= cx <= r else min(abs(cx - l), abs(cx - r))
            if d > 18.0:
                continue
            # 验证不是整行文字粘连：下划线上方 2–8pt 内不能全宽充满文字
            ya = max(0, y - int(8.5 * kz))
            yb = max(ya + 1, y - int(1.6 * kz))
            xa = max(0, int((l + 2.0) * kz))
            xb = min(a.shape[1], int((r - 2.0) * kz))
            if xb <= xa:
                continue
            cols = (a[ya:yb, xa:xb] < 185).any(axis=0)
            fill_ratio = float(cols.mean()) if len(cols) else 1.0
            if fill_ratio > 0.65:
                continue
            key = (round(d, 2), -w_pt)
            if best is None or key < best[0]:
                best = (key, (l, r, y / kz))
    return best[1] if best else None


def find_digit_cluster(
    a: np.ndarray,
    ul_l: float,
    ul_r: float,
    ul_y: float,
    old_box: list[float],
    kz: float,
) -> tuple[float, float, float, float] | None:
    """提取下划线上方的题号数字墨迹边界 (x0, y0, x1, y1)。"""
    ya = max(0, int((ul_y - 12.5) * kz))
    yb = max(ya + 1, int((ul_y - 1.3) * kz))
    xa = max(0, int((ul_l + 1.5) * kz))
    xb = min(a.shape[1], int((ul_r - 1.5) * kz))
    if xb <= xa or yb <= ya:
        return None
    sub = a[ya:yb, xa:xb] < 185
    cols = sub.any(axis=0)
    xs = np.flatnonzero(cols)
    if not len(xs):
        return None
    # 把相距 <= 2.5pt 的两位数拼成一个数字簇
    cuts = np.flatnonzero(np.diff(xs) > max(3, int(round(2.5 * kz))))
    clusters = []
    old_cx = (old_box[0] + old_box[2]) / 2
    ul_mid = (ul_l + ul_r) / 2
    for seg in np.split(xs, cuts + 1):
        dl = (int(seg[0]) + xa) / kz
        dr = (int(seg[-1]) + 1 + xa) / kz
        w_pt = dr - dl
        if 2.2 <= w_pt <= 20.0:
            row_mask = sub[:, int(seg[0]) : int(seg[-1]) + 1].any(axis=1)
            ys = np.flatnonzero(row_mask)
            dy0 = (int(ys[0]) + ya) / kz
            dy1 = (int(ys[-1]) + 1 + ya) / kz
            # 题号数字通常高于 4.5pt（排除逗号/噪点）
            if dy1 - dy0 >= 4.2:
                # 优先选更接近下划线中点且宽于 4pt（两位数字）或接近旧框的簇
                score = abs((dl + dr) / 2 - ul_mid) * 0.7 + abs((dl + dr) / 2 - old_cx) * 0.3
                clusters.append((score, dl, dy0, dr, dy1))
    if not clusters:
        return None
    clusters.sort(key=lambda c: c[0])
    _, dl, dy0, dr, dy1 = clusters[0]
    return dl, dy0, dr, dy1


def fix_paper(pid: str, dry: bool) -> int:
    fitz.TOOLS.mupdf_display_errors(False)
    path = PAPERS_DIR / f"{pid}.json"
    pdf = PAPERS_DIR / "pdf" / f"{pid}.pdf"
    wpath = PAPERS_DIR / "pdf" / f"{pid}.words.json"
    if not (path.exists() and pdf.exists() and wpath.exists()):
        return 0
    paper = json.loads(path.read_text("utf-8"))
    doc = fitz.open(str(pdf))
    wdoc = json.loads(wpath.read_text("utf-8"))
    pages = wdoc["pages"] if isinstance(wdoc, dict) else wdoc

    changed = 0
    for s in paper.get("sections", []):
        if s.get("from"):
            continue
        skind = s.get("kind", "")
        for g in s.get("groups", []):
            for q in g.get("questions", []):
                box, pg = q.get("box"), q.get("page")
                if not (q.get("options") and box and pg and 1 <= pg <= len(pages) and pg <= len(doc)):
                    continue
                p_words = pages[pg - 1]
                if not is_inline_question(skind, p_words, box, q["number"]):
                    continue
                k = float(p_words.get("width", doc[pg - 1].rect.width)) / max(1e-6, doc[pg - 1].rect.width)
                kz = k * Z
                img = page_img(doc, pg)
                ul = find_underline(img, box, kz)
                if not ul:
                    continue
                ul_l, ul_r, ul_y = ul
                dbox = find_digit_cluster(img, ul_l, ul_r, ul_y, box, kz)
                old_cx = (box[0] + box[2]) / 2
                old_cy = (box[1] + box[3]) / 2
                old_half_w = (box[2] - box[0]) / 2
                old_half_h = (box[3] - box[1]) / 2

                if dbox:
                    dl, dy0, dr, dy1 = dbox
                    new_cx = (dl + dr) / 2
                    new_cy = (dy0 + dy1) / 2
                    half_w = max(old_half_w, (dr - dl) / 2 + 1.0)
                    half_h = max(old_half_h, (dy1 - dy0) / 2 + 1.2)
                else:
                    new_cx = (ul_l + ul_r) / 2
                    new_cy = old_cy
                    half_w = old_half_w
                    half_h = old_half_h

                if abs(new_cx - old_cx) <= 1.5 and abs(new_cy - old_cy) <= 2.0:
                    continue

                use_cy = new_cy if abs(new_cy - old_cy) > 2.0 else old_cy
                use_hh = half_h if abs(new_cy - old_cy) > 2.0 else old_half_h
                new_box = [
                    round(float(new_cx - half_w), 1),
                    round(float(use_cy - use_hh), 1),
                    round(float(new_cx + half_w), 1),
                    round(float(use_cy + use_hh), 1),
                ]
                print(f"{pid} Q{q['number']:2d} p{pg}: {box} -> {new_box}", flush=True)
                q["box"] = new_box
                changed += 1

    doc.close()
    if changed and not dry:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        bak = BACKUP_DIR / path.name
        if not bak.exists():
            shutil.copy2(path, bak)
        path.write_text(json.dumps(paper, ensure_ascii=False, indent=1), "utf-8")
    return changed


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    dry = "--dry" in sys.argv
    ids = [a for a in sys.argv[1:] if not a.startswith("--")] or sorted(
        Path(p).stem for p in glob.glob(str(PAPERS_DIR / "*.json"))
    )
    total = sum(fix_paper(i, dry) for i in ids)
    print("改了", total, "处")
