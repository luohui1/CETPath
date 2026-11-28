"""按排版字宽与墨迹间隙逐段重新对齐全库 `.words.json` 的单词框（2026-11-28）。

为什么：
1. `paper_align.py` 用整页中心偏移中位数（`SHIFT_BAD = 0.25`）筛错位页，而混合文本层（如 `cet6-2026-06-1` 第 6 页
   的 `HiddenHorzOCR` 等宽分格）行首和行尾偏移小，整页中位数仅 0.21–0.24 被漏掉，导致行中单词框横偏 6–15pt；
2. 单个词出现字距略宽或撇号/连字符时（`it's`、`we're`、`British-Singaporean`），旧版一词只对一个墨迹块会缩成 2pt 碎片；
3. 双栏或多栏选项行必须先按大空白拆段再对齐，否则容易跨栏错配。

做法（仅修改 `[x0, y0, x1, y1]`，严格保留原词串、句号、数组长度与句子列表 `s`）：
- 按 216dpi（`Z = 3.0`）灰度阈值 `< 165` 渲染页面，将同行词按 `gap > 24pt` 拆成独立栏段；
- 先合并 `<= 1.25pt` 的字内紧凑字距得到原子墨迹块，用比例字宽（`i/l/t` 窄、`m/w/MW` 宽）做单调动态规划：
  支持一词跨 1–6 个子块（撇号/连字符/断笔）与粘连墨迹按字宽谷底切分，并裁掉未进词串的句尾点号；
- 仅在真正降低框边穿字（`edge_bleed`）、消除纵向偏行或去掉虚高白边且不丢墨迹时才替换该段坐标。

用法：
  python -I scripts/paper_word_align.py stats [id前缀 ...]
  python -I scripts/paper_word_align.py apply [id前缀 ...] [--record path.json]
"""

import json
import os
import re
import shutil
import statistics
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

for _env in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_env, "1")

import fitz  # noqa: E402
import numpy as np  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PAPERS_DIR = ROOT / "public" / "papers"
PDF_DIR = PAPERS_DIR / "pdf"
BACKUP = ROOT / "data" / "cache" / "paper-word-align"

Z = 3.0
NARROW = set("iljI1'|!.,:;`")
SEMI = set("frt()-[]\"”’“‘")
WIDE = set("mwABCDFGHJKLNOPQRSTUVXYZ")
VWIDE = set("MW")


def typo_w(word: str) -> float:
    s = 0.0
    for ch in word:
        if ch in NARROW:
            s += 0.28
        elif ch in SEMI:
            s += 0.36
        elif ch in VWIDE:
            s += 0.88
        elif ch in WIDE:
            s += 0.70
        else:
            s += 0.50
    return max(s, 0.28)


def runs_1d(mask: np.ndarray, gap: int) -> list[tuple[int, int]]:
    idx = np.flatnonzero(mask)
    if not len(idx):
        return []
    out: list[tuple[int, int]] = []
    s = p = int(idx[0])
    for v in idx[1:]:
        iv = int(v)
        if iv - p > gap:
            out.append((s, p + 1))
            s = iv
        p = iv
    out.append((s, p + 1))
    return out


def lines_of(ws: list) -> list[list[tuple[int, str, float, float, float, float]]]:
    toks = [(i, t[0], float(t[1]), float(t[2]), float(t[3]), float(t[4])) for i, t in enumerate(ws)]
    if not toks:
        return []
    h = statistics.median(max(1.0, t[5] - t[3]) for t in toks)
    toks.sort(key=lambda t: ((t[3] + t[5]) / 2, t[2]))
    lines, cur, cy = [], [], 0.0
    for t in toks:
        y = (t[3] + t[5]) / 2
        if cur and abs(y - cy) > 0.45 * h:
            lines.append(sorted(cur, key=lambda u: u[2]))
            cur = []
        cur.append(t)
        cy = statistics.median((u[3] + u[5]) / 2 for u in cur)
    if cur:
        lines.append(sorted(cur, key=lambda u: u[2]))
    return lines


def split_columns(line: list, max_gap: float = 24.0) -> list[list]:
    if not line:
        return []
    segs = [[line[0]]]
    for t in line[1:]:
        prev = segs[-1][-1]
        if t[2] - prev[4] > max_gap:
            segs.append([t])
        else:
            segs[-1].append(t)
    return segs


def find_underline_gray(gray: np.ndarray, box: list[float], kz: float) -> tuple[float, float, float] | None:
    x0 = max(0, int((box[0] - 95) * kz))
    x1 = min(gray.shape[1], int((box[2] + 95) * kz))
    if x1 <= x0:
        return None
    cx = (box[0] + box[2]) / 2
    y_lo = max(0, int((box[3] - 3.5) * kz))
    y_hi = min(gray.shape[0], int((box[3] + 5.5) * kz))
    best = None
    for y in range(y_lo, y_hi):
        xs = np.flatnonzero(gray[y, x0:x1] < 185)
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
            ya = max(0, y - int(8.5 * kz))
            yb = max(ya + 1, y - int(1.6 * kz))
            xa = max(0, int((l + 2.0) * kz))
            xb = min(gray.shape[1], int((r - 2.0) * kz))
            if xb <= xa:
                continue
            cols = (gray[ya:yb, xa:xb] < 185).any(axis=0)
            if float(cols.mean()) > 0.65:
                continue
            key = (round(d, 2), -w_pt)
            if best is None or key < best[0]:
                best = (key, (l, r, y / kz))
    return best[1] if best else None


def box_ink(ink: np.ndarray, kz: float, box) -> float:
    x0, y0, x1, y1 = (int(round(v * kz)) for v in box)
    H, W = ink.shape
    x0, x1 = max(0, x0), min(W, x1)
    y0, y1 = max(0, y0), min(H, y1)
    if x1 <= x0 or y1 <= y0:
        return 0.0
    return float(ink[y0:y1, x0:x1].mean())


def edge_bleed(ink: np.ndarray, kz: float, boxes) -> float:
    """外侧 0.35–1.3pt 紧邻边缘仍落到字墨迹的词框占比（穿字率）。"""
    H, W = ink.shape
    bleed = 0
    for x0, y0, x1, y1 in boxes:
        ya, yb = max(0, int(round(y0 * kz))), min(H, int(round(y1 * kz)))
        if yb <= ya:
            continue
        la, lb = max(0, int(round((x0 - 1.3) * kz))), max(0, int(round((x0 - 0.35) * kz)))
        ra, rb = min(W, int(round((x1 + 0.35) * kz))), min(W, int(round((x1 + 1.3) * kz)))
        l_ink = bool(ink[ya:yb, la:lb].any()) if lb > la else False
        r_ink = bool(ink[ya:yb, ra:rb].any()) if rb > ra else False
        if l_ink or r_ink:
            bleed += 1
    return bleed / max(len(boxes), 1)


def align_segment(ink: np.ndarray, k: float, seg: list, has_blanks: bool = False) -> dict[int, list[float]]:
    kz = k * Z
    hs = [max(1.0, t[5] - t[3]) for t in seg]
    h = statistics.median(hs)
    yc = statistics.median((t[3] + t[5]) / 2 for t in seg)
    pad_x = 3.5 * h if has_blanks else 1.8 * h
    xa = min(t[2] for t in seg) - pad_x
    xb = max(t[4] for t in seg) + pad_x

    H, W = ink.shape
    Y0, Y1 = max(0, int((yc - 1.5 * h) * kz)), min(H, int((yc + 1.5 * h) * kz))
    X0, X1 = max(0, int(xa * kz)), min(W, int(xb * kz))
    if Y1 <= Y0 or X1 <= X0:
        return {}

    rows = ink[Y0:Y1, X0:X1].sum(1)
    thr = max(2, 0.012 * (X1 - X0))
    bands = [(a + Y0, b + Y0) for a, b in runs_1d(rows >= thr, gap=max(1, int(0.12 * h * kz)))]
    bands = [b for b in bands if 3.0 * kz <= b[1] - b[0] <= 2.2 * h * kz]
    if not bands:
        return {}
    yc_px = yc * kz
    by0, by1 = min(bands, key=lambda b: abs((b[0] + b[1]) / 2 - yc_px))
    bh = by1 - by0

    col_count = ink[by0:by1, X0:X1].sum(0)
    sub = [(a + X0, b + X0) for a, b in runs_1d(col_count > 0, gap=max(2, int(round(1.25 * kz))))]
    if not sub:
        return {}

    tws = [typo_w(t[1]) for t in seg]
    old_span_px = (max(t[4] for t in seg) - min(t[2] for t in seg)) * kz
    est_em = old_span_px / max(sum(tws) + 0.30 * max(0, len(seg) - 1), 0.5)
    est_em = max(6.5 * kz, min(15.0 * kz, est_em))
    ew_px = [w * est_em for w in tws]
    tc_px = [((t[2] + t[4]) / 2) * kz for t in seg]

    n, m = len(seg), len(sub)
    MAX_SPAN = 6
    MAX_INTERNAL_GAP = 2.4 * kz
    spans_at_end: list[list[tuple[int, int, int]]] = [[] for _ in range(m)]
    for j1 in range(m):
        a_px = sub[j1][0]
        for j2 in range(j1, min(m, j1 + MAX_SPAN)):
            if j2 > j1 and (sub[j2][0] - sub[j2 - 1][1]) > MAX_INTERNAL_GAP:
                break
            spans_at_end[j2].append((j1, a_px, sub[j2][1]))

    INF = 1e18
    dp = np.full((n, m), INF)
    back: list[list[tuple[str, int, int] | None]] = [[None] * m for _ in range(n)]

    def span_cost(tok_i: int, j1: int, j2: int, a_px: int, b_px: int) -> float:
        w_str = seg[tok_i][1]
        has_punct = ("'" in w_str) or ("’" in w_str) or ("-" in w_str)
        bw = b_px - a_px
        bc = (a_px + b_px) / 2
        ew = ew_px[tok_i]
        internal_gaps = [sub[q][0] - sub[q - 1][1] for q in range(j1 + 1, j2 + 1)]
        gap_pen = sum((0.3 if has_punct else 2.8) * g for g in internal_gaps)
        too_narrow = max(0.0, 0.62 * ew - bw) * 3.5 if tws[tok_i] > 0.30 else 0.0
        too_wide = max(0.0, bw - 1.85 * ew) * 2.0
        pos_w = 0.12 if has_blanks else 0.30
        return abs(bw - ew) * 1.1 + abs(bc - tc_px[tok_i]) * pos_w + gap_pen + too_narrow + too_wide

    for j in range(m):
        for j1, a_px, b_px in spans_at_end[j]:
            c = span_cost(0, j1, j, a_px, b_px)
            if c < dp[0, j]:
                dp[0, j] = c
                back[0][j] = ("span", -1, j1)

    for i in range(1, n):
        pref_min = np.full(m, INF)
        pref_arg = np.full(m, -1, dtype=int)
        cur_m, cur_a = INF, -1
        for j in range(m):
            pref_min[j] = cur_m
            pref_arg[j] = cur_a
            if dp[i - 1, j] < cur_m:
                cur_m, cur_a = dp[i - 1, j], j

        for j in range(m):
            for j1, a_px, b_px in spans_at_end[j]:
                if pref_arg[j1] < 0:
                    continue
                c = float(pref_min[j1]) + span_cost(i, j1, j, a_px, b_px)
                if c < dp[i, j]:
                    dp[i, j] = c
                    back[i][j] = ("span", int(pref_arg[j1]), j1)

            if dp[i - 1, j] < INF:
                orig_touch = not has_blanks and (seg[i][2] - seg[i - 1][4]) <= 1.2
                share_pen = (0.15 * bh) if orig_touch else (0.75 * bh)
                bw_j = sub[j][1] - sub[j][0]
                bc = (sub[j][0] + sub[j][1]) / 2
                share_need = ew_px[i - 1] + ew_px[i]
                share_narrow = max(0.0, 0.58 * share_need - bw_j) * 3.5
                pos_w = 0.12 if has_blanks else 0.30
                c = float(dp[i - 1, j]) + share_pen + share_narrow + abs(bc - tc_px[i]) * pos_w
                if c < dp[i, j]:
                    dp[i, j] = c
                    back[i][j] = ("share", j, j)

    end_j = int(np.argmin(dp[n - 1]))
    if dp[n - 1, end_j] >= INF / 2:
        return {}

    groups: list[tuple[list[int], int, int]] = []
    i, j = n - 1, end_j
    while i >= 0:
        step = back[i][j]
        if step is None:
            return {}
        mode, pj, j1 = step
        if mode == "span":
            groups.append(([i], j1, j))
            i -= 1
            j = pj
        else:
            tok_list = [i]
            while i > 0 and back[i][j] is not None and back[i][j][0] == "share":
                i -= 1
                tok_list.append(i)
            first_step = back[i][j]
            if first_step is None:
                return {}
            _, pj2, j1_first = first_step
            tok_list.reverse()
            groups.append((tok_list, j1_first, j))
            i -= 1
            j = pj2
    groups.reverse()

    full_cols = ink[by0:by1, :].sum(0)
    out: dict[int, list[float]] = {}
    for tok_idxs, j1, j2 in groups:
        a_px, b_px = sub[j1][0], sub[j2][1]
        if len(tok_idxs) == 1:
            w_str = seg[tok_idxs[0]][1]
            if not w_str.endswith((".", ",", ";", ":")):
                tail_start = max(a_px + int(2.0 * kz), b_px - int(3.2 * kz))
                zeros = [x for x in range(tail_start, b_px) if full_cols[x] == 0]
                if zeros:
                    z0 = zeros[0]
                    dot_rows = int(ink[by0:by1, z0:b_px].any(1).sum())
                    if dot_rows <= 0.45 * bh:
                        while z0 > a_px + 2 and full_cols[z0 - 1] == 0:
                            z0 -= 1
                        b_px = z0
            out[seg[tok_idxs[0]][0]] = [a_px / kz, by0 / kz, b_px / kz, by1 / kz]
        else:
            ws_t = [ew_px[g] for g in tok_idxs]
            tot_w = max(sum(ws_t), 1e-6)
            cuts = [a_px]
            acc = 0.0
            for wt in ws_t[:-1]:
                acc += wt
                est_cut = a_px + (b_px - a_px) * (acc / tot_w)
                win = int(1.8 * kz)
                lo_x = max(cuts[-1] + 2, int(round(est_cut)) - win)
                hi_x = min(b_px - 2, int(round(est_cut)) + win)
                if lo_x <= hi_x:
                    best_x = min(range(lo_x, hi_x + 1), key=lambda x: (int(full_cols[x]), abs(x - est_cut) * 0.2))
                    cuts.append(best_x)
                else:
                    cuts.append(min(b_px - 1, max(cuts[-1] + 1, int(round(est_cut)))))
            cuts.append(b_px)
            for g, cx0, cx1 in zip(tok_idxs, cuts[:-1], cuts[1:]):
                while cx0 < cx1 - 2 and full_cols[cx0] == 0:
                    cx0 += 1
                while cx1 > cx0 + 2 and full_cols[cx1 - 1] == 0:
                    cx1 -= 1
                out[seg[g][0]] = [cx0 / kz, by0 / kz, cx1 / kz, by1 / kz]
    return out


def decide_segment(
    ink: np.ndarray,
    k: float,
    seg: list,
    got: dict[int, list[float]],
    has_blanks: bool = False,
) -> dict[int, list[float]] | None:
    if len(got) != len(seg):
        return None
    kz = k * Z
    old_boxes = [t[2:6] for t in seg]
    new_boxes = [got[t[0]] for t in seg]
    old_d = float(np.mean([box_ink(ink, kz, b) for b in old_boxes]))

    # 跳过字体切碎的矢量行（如 Im+provi+ng、Secti+on+A），它们原来就贴着笔画
    if len(seg) >= 2:
        touch_short = sum(
            1 for a, b in zip(seg, seg[1:])
            if (b[2] - a[4]) <= 0.6 and (len(a[1]) <= 4 or len(b[1]) <= 4)
        )
        if touch_short >= 0.22 * (len(seg) - 1) and old_d >= 0.18:
            return None

    tws = [typo_w(t[1]) for t in seg]
    old_span = max(b[2] for b in old_boxes) - min(b[0] for b in old_boxes)
    est_em = max(6.5, min(15.0, old_span / max(sum(tws) + 0.30 * max(0, len(seg) - 1), 0.5)))
    for t, nb, tw in zip(seg, new_boxes, tws):
        nw = nb[2] - nb[0]
        ew = tw * est_em
        if len(t[1]) >= 2 and nw < 2.2:
            return None
        if nw < 0.42 * ew - 1.0 or nw > 2.3 * ew + 4.0:
            return None

    if len(seg) >= 5:
        nws = np.array([b[2] - b[0] for b in new_boxes], dtype=float)
        tw_arr = np.array(tws, dtype=float)
        if nws.std() > 0 and tw_arr.std() > 0 and float(np.corrcoef(tw_arr, nws)[0, 1]) < 0.85:
            return None

    new_d = float(np.mean([box_ink(ink, kz, b) for b in new_boxes]))
    if new_d < old_d - 0.015:
        return None

    old_bleed = edge_bleed(ink, kz, old_boxes)
    new_bleed = edge_bleed(ink, kz, new_boxes)
    dxs = [abs((a[0] + a[2]) / 2 - (b[0] + b[2]) / 2) for a, b in zip(old_boxes, new_boxes)]
    dws = [abs((a[2] - a[0]) - (b[2] - b[0])) for a, b in zip(old_boxes, new_boxes)]
    dys = [abs((a[1] + a[3]) / 2 - (b[1] + b[3]) / 2) for a, b in zip(old_boxes, new_boxes)]
    hrs = [(a[3] - a[1]) / max(0.5, b[3] - b[1]) for a, b in zip(old_boxes, new_boxes)]

    horiz_fix = (max(dxs) >= 1.5 or max(dws) >= 2.0) and old_bleed >= 0.12 and new_bleed <= old_bleed - 0.06
    blank_fix = False
    if has_blanks:
        ch_pairs = [
            (ob, nb)
            for ob, nb, dx, dw in zip(old_boxes, new_boxes, dxs, dws)
            if dx >= 1.5 or dw >= 2.0
        ]
        if len(ch_pairs) >= 2:
            ch_old_b = [p[0] for p in ch_pairs]
            ch_new_b = [p[1] for p in ch_pairs]
            ch_old_d = float(np.mean([box_ink(ink, kz, b) for b in ch_old_b]))
            ch_new_d = float(np.mean([box_ink(ink, kz, b) for b in ch_new_b]))
            ch_old_bl = edge_bleed(ink, kz, ch_old_b)
            ch_new_bl = edge_bleed(ink, kz, ch_new_b)
            blank_fix = new_bleed <= old_bleed + 0.02 and (
                (ch_new_d >= ch_old_d + 0.015 and ch_new_bl <= ch_old_bl + 0.02)
                or (ch_old_bl >= 0.25 and ch_new_bl <= ch_old_bl - 0.15 and ch_new_d >= ch_old_d - 0.01)
            )
    vert_fix = statistics.median(dys) >= 1.2 and new_d >= old_d + 0.01 and new_bleed <= old_bleed + 0.05
    if horiz_fix or blank_fix or vert_fix:
        return got

    if statistics.median(hrs) >= 1.35 and new_d >= old_d + 0.025:
        if new_bleed <= old_bleed + 0.03:
            return got
        # 原横坐标已经齐整，只把虚高上下边收贴文字带
        vcrop = {t[0]: [t[2], got[t[0]][1], t[4], got[t[0]][3]] for t in seg}
        v_d = float(np.mean([box_ink(ink, kz, vcrop[t[0]]) for t in seg]))
        if v_d >= old_d + 0.025:
            return vcrop
    return None


def process_paper(args: tuple[str, bool]) -> tuple[str, bool, int, int, int, int]:
    pid, do_apply = args
    fitz.TOOLS.mupdf_display_errors(False)
    wf = PDF_DIR / f"{pid}.words.json"
    pf = PDF_DIR / f"{pid}.pdf"
    if not wf.exists() or not pf.exists():
        return pid, False, 0, 0, 0, 0

    raw_text = wf.read_text("utf-8")
    W = json.loads(raw_text)
    pj_file = PAPERS_DIR / f"{pid}.json"
    inline_qs_by_page: dict[int, list[list[float]]] = {}
    if pj_file.exists():
        pj = json.loads(pj_file.read_text("utf-8"))
        for sec in pj.get("sections", []):
            if sec.get("from"):
                continue
            skind = sec.get("kind", "")
            for grp in sec.get("groups", []):
                for q in grp.get("questions", []):
                    qpg, qbox = q.get("page"), q.get("box")
                    if not (q.get("options") and qpg and qbox and 1 <= qpg <= len(W["pages"])):
                        continue
                    pw_s = W["pages"][qpg - 1].get("s", [])
                    q_cy = (qbox[1] + qbox[3]) / 2
                    has_left = any(w[3] <= qbox[0] + 0.5 and w[2] <= q_cy <= w[4] for w in W["pages"][qpg - 1].get("w", []))
                    has_mark = any(f"___{q['number']}___" in st for st in pw_s)
                    if skind == "banked" or has_left or has_mark:
                        inline_qs_by_page.setdefault(qpg - 1, []).append(qbox)

    doc = fitz.open(str(pf))
    pages_changed = 0
    segs_applied = 0
    words_changed = 0
    total_words = 0

    for pi, pg in enumerate(W["pages"]):
        if pi >= len(doc):
            continue
        ws = pg["w"]
        total_words += len(ws)
        if len(ws) < 3:
            continue
        page = doc[pi]
        pix = page.get_pixmap(matrix=fitz.Matrix(Z, Z), colorspace=fitz.csGRAY, alpha=False)
        gray = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width)
        ink = gray < 165
        k = page.rect.width / pg["width"]
        kz = k * Z

        page_blanks: list[tuple[float, float, float, float]] = []
        for qbox in inline_qs_by_page.get(pi, []):
            ul = find_underline_gray(gray, qbox, kz)
            if ul:
                page_blanks.append((ul[0], ul[1], ul[2], (qbox[1] + qbox[3]) / 2))

        orig_len = len(ws)
        orig_words = [w[0] for w in ws]
        orig_sids = [w[5] for w in ws]
        page_dirty = False

        for line in lines_of(ws):
            line_y0 = min(t[3] for t in line)
            line_y1 = max(t[5] for t in line)
            line_yc = (line_y0 + line_y1) / 2
            line_blanks = [
                (ul_l, ul_r)
                for (ul_l, ul_r, ul_y, b_cy) in page_blanks
                if abs(b_cy - line_yc) <= 6.0 or (line_y0 - 2.0 <= ul_y <= line_y1 + 5.5)
            ]
            if line_blanks:
                work_ink = ink.copy()
                yb0 = max(0, int(round((line_y0 - 3.0) * kz)))
                yb1 = min(work_ink.shape[0], int(round((line_y1 + 5.5) * kz)))
                for ul_l, ul_r in line_blanks:
                    xl = max(0, int(round((ul_l - 0.3) * kz)))
                    xr = min(work_ink.shape[1], int(round((ul_r + 0.3) * kz)))
                    if xr > xl and yb1 > yb0:
                        work_ink[yb0:yb1, xl:xr] = False
            else:
                work_ink = ink

            for seg in split_columns(line, 75.0 if line_blanks else 24.0):
                got = align_segment(work_ink, k, seg, has_blanks=bool(line_blanks))
                if not got:
                    continue
                chosen = decide_segment(work_ink, k, seg, got, has_blanks=bool(line_blanks))
                if not chosen:
                    continue
                seg_dirty = False
                for t in seg:
                    idx = t[0]
                    nb = [round(float(v), 1) for v in chosen[idx]]
                    if nb != ws[idx][1:5]:
                        ws[idx][1:5] = nb
                        words_changed += 1
                        seg_dirty = True
                if seg_dirty:
                    segs_applied += 1
                    page_dirty = True

        assert len(ws) == orig_len
        assert [w[0] for w in ws] == orig_words
        assert [w[5] for w in ws] == orig_sids
        if page_dirty:
            pages_changed += 1

    doc.close()
    if do_apply and words_changed > 0:
        bak = BACKUP / wf.name
        if not bak.exists():
            shutil.copy2(wf, bak)
        out_text = json.dumps(W, ensure_ascii=False, separators=(",", ":"))
        fd, tmp_name = tempfile.mkstemp(suffix=".json", dir=wf.parent)
        os.close(fd)
        tmp_path = Path(tmp_name)
        try:
            tmp_path.write_text(out_text, "utf-8")
            check = json.loads(tmp_path.read_text("utf-8"))
            assert len(check["pages"]) == len(W["pages"])
            os.replace(tmp_path, wf)
        finally:
            if tmp_path.exists():
                tmp_path.unlink()

    return pid, words_changed > 0, pages_changed, segs_applied, words_changed, total_words


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    args = sys.argv[1:]
    cmd = args[0] if args and args[0] in ("stats", "apply") else "stats"
    rest = args[1:] if args and args[0] in ("stats", "apply") else args

    record_path: Path | None = None
    prefixes: list[str] = []
    i = 0
    while i < len(rest):
        if rest[i] == "--record" and i + 1 < len(rest):
            record_path = Path(rest[i + 1])
            i += 2
        else:
            prefixes.append(rest[i])
            i += 1

    all_pids = sorted(p.name[:-len(".words.json")] for p in PDF_DIR.glob("*.words.json"))
    if prefixes:
        all_pids = [pid for pid in all_pids if any(pid.startswith(pr) for pr in prefixes)]

    do_apply = cmd == "apply"
    if do_apply:
        BACKUP.mkdir(parents=True, exist_ok=True)

    changed_pids: list[str] = []
    tot_pages = tot_segs = tot_words = 0
    with ProcessPoolExecutor(max_workers=8) as pool:
        for pid, changed, pg_c, seg_c, w_c, tot_w in pool.map(process_paper, [(p, do_apply) for p in all_pids]):
            if changed:
                changed_pids.append(pid)
                tot_pages += pg_c
                tot_segs += seg_c
                tot_words += w_c
                print(f"{pid:18s} {'已校准' if do_apply else '需校准'} {pg_c:2d} 页 / {seg_c:3d} 段 / {w_c:4d}/{tot_w} 词", flush=True)

    if do_apply and record_path is not None:
        record_path.parent.mkdir(parents=True, exist_ok=True)
        record_path.write_text(json.dumps(changed_pids, ensure_ascii=False, indent=2), "utf-8")

    print(f"合计：扫描 {len(all_pids)} 套，{'校准' if do_apply else '需校准'} {len(changed_pids)} 套 / {tot_pages} 页 / {tot_segs} 段 / {tot_words} 词")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
