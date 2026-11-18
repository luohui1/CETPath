"""卷面单词框、题号圆圈按卷面图像重新对齐（2026-11-11）。

为什么：一部分原卷的文字层坏了，单词层用的是 OCR 整行结果、按字符数平均分给每个词（import_cet.words_of），
或者扫描件自带的文字层本身就歪；点一个词常查到旁边的词，题号旁的圆圈（question.box）也偏半行。

做法（只用这一页渲染出来的图，不重新识别文字）：
- 单词：按行分组（同一行的词 y 中心相近）；在这一行附近找真实的文字带（有墨迹的行），带里按列找墨迹块，
  块与块之间的空白够宽就是词间空；把这一行的词按顺序和墨迹块对上（动态规划：词的旧中心离块中心越近越好，
  可以跳过块——选项字母、题号、汉字不在单词层里——一个块也可以分给相邻几个词）。新框就是墨迹块的范围、高度是文字带。
  这一行新框里的墨迹比旧框多才换。
- 题号圆圈：在 question.box 附近找最近的一行文字带，带里离旧框最近的那团墨迹（"39."）就是题号，框对过去。

复核：新框宽度和词长的相关系数低于 0.8、或比旧框掉 0.15 以上的页不换（对错了词）。
只处理错位的页：先按图像量出每个词的新框，新旧框中心平均差 0.3 个行高以上才换（对齐的页几乎不动）。题号框：每道题都按图像找题号所在的文字带，竖直中心差 1.5pt 以上才挪（只挪上下）。

  python -I scripts/paper_align.py stats [id 前缀 ...]     每页的对齐分数
  python -I scripts/paper_align.py apply [id 前缀 ...]     校正并写回 words.json 和试卷 JSON（原文件存进 data/cache/paper-align/）
"""
import json
import os
import re
import shutil
import statistics
import sys
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "1")
import fitz  # noqa: E402
import numpy as np  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / "public"
BACKUP = ROOT / "data" / "cache" / "paper-align"
Z = 2.0  # 144dpi


sys.stdout.reconfigure(encoding="utf-8")


def render(page):
    pix = page.get_pixmap(matrix=fitz.Matrix(Z, Z), colorspace=fitz.csGRAY)
    a = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    return a < 150


def density(ink, k, box):
    x0, y0, x1, y1 = (int(v * k * Z) for v in box)
    h, w = ink.shape
    x0, x1, y0, y1 = max(0, x0), min(w, x1), max(0, y0), min(h, y1)
    if x1 <= x0 or y1 <= y0:
        return 0.0
    return float(ink[y0:y1, x0:x1].mean())


def runs(mask, gap):
    """一维布尔数组里的连续段，间隔小于 gap 的并成一段：[(起, 止)]（止不含）"""
    out = []
    idx = np.flatnonzero(mask)
    if not len(idx):
        return out
    s = p = idx[0]
    for i in idx[1:]:
        if i - p > gap:
            out.append((s, p + 1))
            s = i
        p = i
    out.append((s, p + 1))
    return out


def band_near(ink, x0, x1, yc, h, k):
    """(x0,x1) 这段横向范围里，离 yc 最近的一条文字带（像素行范围）；没有返回 None"""
    H = ink.shape[0]
    Y0, Y1 = max(0, int((yc - 1.6 * h) * k * Z)), min(H, int((yc + 1.6 * h) * k * Z))
    X0, X1 = max(0, int(x0 * k * Z)), min(ink.shape[1], int(x1 * k * Z))
    if Y1 <= Y0 or X1 <= X0:
        return None
    rows = ink[Y0:Y1, X0:X1].sum(1)
    thr = max(2, 0.01 * (X1 - X0))
    bands = [(a + Y0, b + Y0) for a, b in runs(rows >= thr, gap=int(0.12 * h * k * Z) or 1)]
    # 文字带至少 3pt 高（只有数字的一行也算）、最多 2.2 个行高（旧框本身可能偏高，不能拿它当下限）
    bands = [b for b in bands if 3 * k * Z <= b[1] - b[0] <= 2.2 * h * k * Z]
    if not bands:
        return None
    yc_px = yc * k * Z
    return min(bands, key=lambda b: abs((b[0] + b[1]) / 2 - yc_px))


def align_line(ink, k, toks):
    """一行的词 [(序号, 词, x0, y0, x1, y1)] → {序号: 新框}（单位：单词层坐标）；对不上返回 {}"""
    hs = [t[5] - t[3] for t in toks]
    h = statistics.median(hs)
    yc = statistics.median((t[3] + t[5]) / 2 for t in toks)
    xa, xb = min(t[2] for t in toks) - 1.5 * h, max(t[4] for t in toks) + 1.5 * h
    band = band_near(ink, xa, xb, yc, h, k)
    if band is None:
        return {}
    by0, by1 = band
    bh = by1 - by0
    X0, X1 = max(0, int(xa * k * Z)), min(ink.shape[1], int(xb * k * Z))
    cols = ink[by0:by1, X0:X1].any(0)
    blobs = [(a + X0, b + X0) for a, b in runs(cols, gap=max(2, int(0.28 * bh)))]
    if not blobs:
        return {}
    tc = [((t[2] + t[4]) / 2) * k * Z for t in toks]
    bc = [(a + b) / 2 for a, b in blobs]
    n, m = len(toks), len(blobs)
    INF = 1e18
    MERGE = 0.6 * bh  # 两个词分到同一块的罚分
    # dp[i][j]：前 i 个词，第 i 个词落在块 j 上
    dp = np.full((n, m), INF)
    back = np.zeros((n, m), dtype=int)
    for j in range(m):
        dp[0, j] = abs(tc[0] - bc[j])
    for i in range(1, n):
        best_prev, arg = INF, -1
        for j in range(m):
            # 和上一个词同块
            same = dp[i - 1, j] + MERGE
            # 上一个词在更前面的块
            if j > 0 and dp[i - 1, j - 1] < best_prev:
                best_prev, arg = dp[i - 1, j - 1], j - 1
            cost = abs(tc[i] - bc[j])
            if best_prev <= same:
                dp[i, j], back[i, j] = best_prev + cost, arg
            else:
                dp[i, j], back[i, j] = same + cost, j
    j = int(np.argmin(dp[n - 1]))
    assign = [0] * n
    for i in range(n - 1, -1, -1):
        assign[i] = j
        j = back[i, j]
    # 同一块里的几个词按字母数分
    out = {}
    i = 0
    while i < n:
        j = assign[i]
        group = [i]
        while i + len(group) < n and assign[i + len(group)] == j:
            group.append(i + len(group))
        a, b = blobs[j]
        lens = [len(toks[g][1]) + 1 for g in group]
        tot = sum(lens)
        x = a
        for g, ln in zip(group, lens):
            x2 = x + (b - a) * ln / tot
            out[toks[g][0]] = [x / (k * Z), by0 / (k * Z), x2 / (k * Z), by1 / (k * Z)]
            x = x2
        i += len(group)
    return out


def lines_of(ws):
    toks = [(i, t[0], t[1], t[2], t[3], t[4]) for i, t in enumerate(ws)]
    if not toks:
        return []
    h = statistics.median(t[5] - t[3] for t in toks)
    toks.sort(key=lambda t: ((t[3] + t[5]) / 2, t[2]))
    lines, cur, cy = [], [], None
    for t in toks:
        y = (t[3] + t[5]) / 2
        if cur and abs(y - cy) > 0.45 * h:
            lines.append(sorted(cur, key=lambda t: t[2]))
            cur = []
        cur.append(t)
        cy = statistics.median((u[3] + u[5]) / 2 for u in cur)
    if cur:
        lines.append(sorted(cur, key=lambda t: t[2]))
    return lines


def page_score(ink, k, ws):
    ds = [density(ink, k, t[1:5]) for t in ws if re.match(r"[A-Za-z]{3,}", t[0])]
    return statistics.median(ds) if len(ds) >= 10 else None


def shift_of(old, new):
    """新旧词框中心的偏移（按行高算）的中位数：对齐的页接近 0，错位的页明显大"""
    ds = []
    for a, b in zip(old, new):
        if a[1:5] == b[1:5]:
            continue
        h = max(1.0, a[4] - a[2])
        ds.append(max(abs((a[1] + a[3]) / 2 - (b[1] + b[3]) / 2), abs((a[2] + a[4]) / 2 - (b[2] + b[4]) / 2)) / h)
    return statistics.median(ds) if len(ds) >= 10 else 0.0


SHIFT_BAD = 0.25  # 词框平均要挪 0.25 个行高以上算错位页
TALL_BAD = 1.5  # 旧框比真实文字带高 50% 以上也算（扫描件自带的文字层：一个框一行半高，点上一行下一行都落到它上面）


def len_corr(ws):
    """词框宽度和词长（字母数）的相关系数"""
    pairs = [(len(t[0]), t[3] - t[1]) for t in ws if len(t[0]) >= 2]
    if len(pairs) <= 10:
        return 1.0
    a = np.array(pairs, dtype=float)
    if a[:, 0].std() == 0 or a[:, 1].std() == 0:
        return 1.0
    return float(np.corrcoef(a[:, 0], a[:, 1])[0, 1])


def tall_of(old, new):
    rs = [(a[4] - a[2]) / max(0.5, b[4] - b[2]) for a, b in zip(old, new) if a[1:5] != b[1:5]]
    return statistics.median(rs) if len(rs) >= 10 else 1.0


def fix_words(ink, k, pg):
    """返回 (新词表, 改了几个词)"""
    ws = pg["w"]
    new = [list(t) for t in ws]
    changed = 0
    for line in lines_of(ws):
        got = align_line(ink, k, line)
        if not got:
            continue
        old_d = np.mean([density(ink, k, t[2:6]) for t in line])
        new_d = np.mean([density(ink, k, got[t[0]]) for t in line if t[0] in got])
        if new_d <= old_d:
            continue
        for t in line:
            if t[0] in got:
                new[t[0]][1:5] = [round(v, 1) for v in got[t[0]]]
                changed += 1
    return new, changed


def fix_qbox(ink, k, box):
    """题号框对到附近真实的题号墨迹；找不到返回 None"""
    h = max(6.0, box[3] - box[1])
    yc = (box[1] + box[3]) / 2
    band = band_near(ink, box[0] - 10, box[2] + 10, yc, h, k)
    if band is None:
        return None
    by0, by1 = band
    X0, X1 = max(0, int((box[0] - 12) * k * Z)), min(ink.shape[1], int((box[2] + 12) * k * Z))
    cols = ink[by0:by1, X0:X1].any(0)
    groups = [(a + X0, b + X0) for a, b in runs(cols, gap=max(2, int(0.3 * (by1 - by0))))]
    if not groups:
        return None
    cx = (box[0] + box[2]) / 2 * k * Z
    a, b = min(groups, key=lambda g: abs((g[0] + g[1]) / 2 - cx))
    nb = [a / (k * Z), by0 / (k * Z), b / (k * Z), by1 / (k * Z)]
    if not (2 <= nb[2] - nb[0] <= 40 and abs((nb[1] + nb[3]) / 2 - yc) <= 14):
        return None
    return [round(v, 1) for v in nb]


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "stats"
    pre = sys.argv[2:]
    idx = json.loads((PUB / "papers" / "index.json").read_text("utf-8"))
    ids = [x["id"] for x in idx if not pre or any(x["id"].startswith(a) for a in pre)]
    tot_w = tot_q = bad_pages = 0
    for pid in ids:
        pf = PUB / "papers" / f"{pid}.json"
        p = json.loads(pf.read_text("utf-8"))
        wf = PUB / p["pdf"]["words"].lstrip("/")
        W = json.loads(wf.read_text("utf-8"))
        doc = fitz.open(PUB / p["pdf"]["src"].lstrip("/"))
        qs = [q for s in p["sections"] for g in s["groups"] for q in g["questions"] if q.get("box") and q.get("page")]
        n_w = n_q = 0
        report = []
        for pi, pg in enumerate(W["pages"]):
            if pi >= len(doc):
                continue
            page = doc[pi]
            k = page.rect.width / pg["width"]
            ink = render(page)
            sc = page_score(ink, k, pg["w"])
            if sc is not None:
                new, c = fix_words(ink, k, pg)
                sh = shift_of(pg["w"], new)
                tl = tall_of(pg["w"], new)
                # 复核：词框宽度应该跟着词长走（对错了词时这个相关明显变差）；新框比旧框差太多的页不换
                if (sh >= SHIFT_BAD or tl >= TALL_BAD) and not (len_corr(new) < 0.8 or len_corr(new) < len_corr(pg["w"]) - 0.15):
                    bad_pages += 1
                    sc2 = page_score(ink, k, new)
                    report.append(f"p{pi + 1} 偏 {sh:.2f} 行高、框高 {tl:.1f} 倍，墨迹 {sc:.2f}→{sc2:.2f}")
                    if cmd == "apply":
                        pg["w"] = new
                        n_w += c
            for q in qs:
                if q["page"] != pi + 1:
                    continue
                # 每道题都按图像找题号所在的文字带：圆圈的上下位置取框的竖直中心，差 1.5pt 以上才挪（对齐的题几乎不动）
                nb = fix_qbox(ink, k, q["box"])
                ob = q["box"]
                # 只对竖直方向（圆圈偏上偏下的毛病）；左右按原框（数字"1"很细，量左边缘不准）；最多挪原框高度的 60%，免得跳到别的行
                dy = ((nb[1] + nb[3]) - (ob[1] + ob[3])) / 2 if nb else 0
                if nb:
                    nb = [ob[0], nb[1], ob[2], nb[3]]
                if nb and 1.5 < abs(dy) <= 0.6 * (ob[3] - ob[1]) and density(ink, k, nb) >= density(ink, k, ob) * 0.9:
                    n_q += 1
                    if cmd == "apply":
                        q["box"] = nb
        tot_w += n_w
        tot_q += n_q
        if report or n_q:
            print(f"{pid}：{'、'.join(report) or '单词层没问题'}；题号框{'挪了' if cmd == 'apply' else '要挪'} {n_q} 个" + (f"；改了 {n_w} 个词框" if n_w else ""), flush=True)
        if cmd == "apply" and (n_w or n_q):
            BACKUP.mkdir(parents=True, exist_ok=True)
            for f in (pf, wf):
                b = BACKUP / f.name
                if not b.exists():
                    shutil.copy2(f, b)
            if n_w:
                wf.write_text(json.dumps(W, ensure_ascii=False, separators=(",", ":")), "utf-8")
            if n_q:
                pf.write_text(json.dumps(p, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(f"对不齐的页 {bad_pages}；题号框 {tot_q} 个；词框 {tot_w} 个")


if __name__ == "__main__":
    main()
