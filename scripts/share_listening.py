"""四六级第 3 套（2020-09、2022-06 是第 2 套）原卷不印听力：真考时它的听力和同场另一套是同一份录音，
只是选项顺序不同，所以原卷只印一句"本套听力与第 X 套相同"。这里把那一套的听力接进来，做成一套完整的卷子：

  卷面  把那一套的听力页（从"Part II Listening Comprehension"到"Part III Reading Comprehension"之前）
        裁下来，插到本套写作和阅读之间；本套原来那段"听力与前两套相同"的说明去掉。
        生成的 PDF 和文字层覆盖 public/papers/pdf/<id>.pdf、<id>.words.json。
  题目  听力题目、答案、录音、逐字稿照搬那一套（答案键和接进来的卷面是同一种选项顺序）。
  解析  解析层 public/papers/explain/<id>.json 里补上这些听力题；本套自己的题按 quote 重新在新卷面上定位。

cet6-2021-12-3 的选词填空也没印（和第 1 套相同），一起接过来。

接哪一套：原卷写明了的照写的（四级 2017-06、2024-12 起是第 2 套；六级 2021-12 是第 2 套，2025-06 起是第 1 套；
2020-09、2022-06 只考了一套听力，第 2 套接第 1 套）。只写"与前两套相同"的，是不同考区第 3 套配的听力不同，
两套都是真考过的：接逐字稿和解析更全的那套，一样全就接第 2 套。

可以重复运行：第一次运行时把导入脚本生成的原样（没接听力的）存到 data/cache/cet-shared/，以后都从原样重做；
重导了某一套（试卷 JSON 里没有 shared 标记）就把新导的当原样。改了被借的那一套（答案、逐字稿、解析）后也要重跑。

  python -I scripts/share_listening.py              全部
  python -I scripts/share_listening.py cet4-2024-12-3
  python -I scripts/share_listening.py --check      只核对：新卷面上每个词的位置是不是原来那个词
"""

import argparse
import copy
import json
import re
import shutil
import sys
from pathlib import Path

import fitz

sys.path.insert(0, str(Path(__file__).resolve().parent))
from structure_explanations import find_quote_on_pages, section_spans  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PAPERS = ROOT / "public" / "papers"
PDF = PAPERS / "pdf"
EXPLAIN = PAPERS / "explain"
BASE = ROOT / "data" / "cache" / "cet-shared"

# 原卷写明了听力和哪套相同的（原文摘在后面）。没列的按"逐字稿和解析更全的那套，一样就第 2 套"
STATED = {
    "cet4-2017-06-3": (2, "本套的听力内容与第二套相同"),
    "cet4-2024-12-3": (2, "官方第三套真题的听力试题与第二套真题的一致，只是选项顺序不同"),
    "cet4-2025-06-3": (2, "官方第三套真题的听力试题与第二套真题的一致，只是选项顺序不同"),
    "cet4-2025-12-3": (2, "官方第三套真题的听力试题与第二套真题的一致"),
    "cet4-2026-06-3": (2, "官方第三套真题的听力试题与第二套真题的一致，只是选项顺序不同"),
    "cet4-2020-09-2": (1, "2020年9月四级考试全国共考了一套听力，本套真题听力与第一套内容相同，只是选项顺序不同"),
    "cet4-2022-06-2": (1, "2022年6月英语四级考试实考1套听力，本套听力内容与第1套完全一致，只是选项顺序不同"),
    "cet6-2020-09-2": (1, "2020年9月六级考试全国共考了1套听力，本套听力试题同第1套试题一致"),
    "cet6-2022-06-2": (1, "2022年6月英语六级考试实考1套听力，本套听力内容与第1套完全一致，只是选项顺序不同"),
    "cet6-2021-12-3": (2, "第3套真题听力与第2套内容完全相同，只是题目选项顺序不同"),
    "cet6-2025-06-3": (1, "官方第三套真题的听力试题与第一套真题的一致，只是选项顺序不同"),
    "cet6-2025-12-3": (1, "官方第三套真题的听力试题与第一套真题的一致，只是选项顺序不同"),
    "cet6-2026-06-3": (1, "官方第三套真题的听力试题与第一套真题的一致，只是选项顺序不同"),
}
# 卷面没印、和同场别的套相同的其他部分：{目标: [(部分 id, 来源套号, 依据)]}
EXTRA = {
    "cet6-2021-12-3": [("reading-a", 1, "本套卷面没有印选词填空，与同场第 1 套相同")],
}
# 卷面上"Part II Listening Comprehension"那行没有文字层（扫描图）的：手动给出这行的 (页, y)（对过卷面图）
LISTEN_HEAD = {
    "cet6-2017-12-3": (1, 95),
}


def jload(p):
    return json.loads(Path(p).read_text("utf-8"))


def jsave(p, data, indent=2):
    Path(p).write_text(json.dumps(data, ensure_ascii=False, indent=indent) + "\n", "utf-8")


def sib_id(pid, n):
    return re.sub(r"-\d$", f"-{n}", pid)


def has_listening(paper):
    return any(s["kind"] == "listening" for s in paper["sections"])


def targets():
    """同场有带听力的套、自己没有听力（也不是只有作文翻译的空卷）的四六级卷子"""
    out = []
    for f in sorted(PAPERS.glob("cet*.json")):
        p = jload(f)
        if p.get("sample") or not p.get("set") or (p.get("shared") is None and has_listening(p)):
            continue
        own = [s for s in p["sections"] if not s.get("from")]
        if not any(q.get("options") for s in own for g in s["groups"] for q in g["questions"]):
            continue
        if any(PAPERS.joinpath(sib_id(p["id"], n) + ".json").exists() for n in (1, 2) if n != p["set"]):
            out.append(p["id"])
    return out


# ---------- 原样（没接听力的）----------


def load_base(pid):
    """返回 (paper, words_pages, pdf 路径)。试卷 JSON 没有 shared 标记就是刚导入的原样：存一份"""
    cur = jload(PAPERS / f"{pid}.json")
    d = BASE / pid
    if not cur.get("shared"):
        d.mkdir(parents=True, exist_ok=True)
        jsave(d / "paper.json", cur)
        shutil.copyfile(PDF / f"{pid}.pdf", d / "paper.pdf")
        shutil.copyfile(PDF / f"{pid}.words.json", d / "words.json")
    elif not (d / "paper.json").exists():
        raise SystemExit(f"{pid} 已经接过听力，但 {d} 里没有原样，要重导这一套")
    return jload(d / "paper.json"), jload(d / "words.json")["pages"], d / "paper.pdf"


def listening_quality(pid):
    """逐字稿和解析全不全：听力题里有结构化解析的题数 + 逐字稿有字的句数 / 10"""
    p = jload(PAPERS / f"{pid}.json")
    ep = EXPLAIN / f"{pid}.json"
    layer = jload(ep)["questions"] if ep.exists() else {}
    qs = [q["id"] for s in p["sections"] if s["kind"] == "listening" for g in s["groups"] for q in g["questions"]]
    fields = sum(1 for q in qs if (layer.get(q) or {}).get("fields"))
    lines = sum(1 for s in (p.get("audio") or {}).get("segments", []) for l in s["lines"] if l.get("kind") not in ("directions", "cue", "question") and len(l.get("text", "")) > 20)
    return fields + lines / 10


def choose_source(pid, paper, prev=None):
    if pid in STATED:
        n, basis = STATED[pid]
        return n, f"原卷说明：{basis}"
    if prev:
        # 接过的沿用原来那套（两套逐字稿、解析补全以后"哪套更全"会变，不来回换）
        return int(prev["from"][-1]), prev["basis"]
    sibs = [n for n in (1, 2) if n != paper["set"] and has_listening(jload(PAPERS / f"{sib_id(pid, n)}.json"))]
    if len(sibs) == 1:
        return sibs[0], "同场只有这一套有听力"
    q = {n: listening_quality(sib_id(pid, n)) for n in sibs}
    n = 1 if q[1] > q[2] else 2
    why = "第 1 套的逐字稿和解析更全" if n == 1 else ("第 2 套的逐字稿和解析更全" if q[2] > q[1] else "两套一样全，接第 2 套")
    return n, f"原卷只说听力与同场前两套之一相同（不同考区第 3 套配的听力不同，两套都真考过），{why}"


# ---------- 卷面上的行 ----------


def lines_of(page):
    """把一页的词按行归并：[(y0, y1, 小写字母串)]"""
    rows = []
    for w in sorted(page["w"], key=lambda w: (w[2] + w[4]) / 2):
        cy = (w[2] + w[4]) / 2
        if rows and abs(rows[-1]["cy"] - cy) < 5:
            r = rows[-1]
            r["y0"], r["y1"] = min(r["y0"], w[2]), max(r["y1"], w[4])
            r["words"].append(w)
        else:
            rows.append({"cy": cy, "y0": w[2], "y1": w[4], "words": [w]})
    out = []
    for r in rows:
        txt = re.sub(r"[^a-z]", "", "".join(w[0] for w in sorted(r["words"], key=lambda w: w[1])).lower())
        out.append((r["y0"], r["y1"], txt))
    return out


def find_line(pages, start, end, test):
    """在 (页, y) 区间 [start, end) 里找第一行满足 test 的，返回 (页, y0)"""
    for pi in range(start[0], end[0] + 1):
        for y0, y1, txt in lines_of(pages[pi - 1]):
            if (pi, y0) < start or (pi, y0) >= end:
                continue
            if test(txt):
                return (pi, y0)
    return None


def is_listening_head(t):
    return "listening" in t or ("partii" in t and "listen" in t) or "listeningcomprehension" in t


def is_reading_head(t):
    return "reading" in t and "compre" in t


def anchor_pos(sec):
    a = sec.get("anchor")
    return (a["page"], a["box"][1]) if a else None


# ---------- 卷面区域 ----------


class Region:
    def __init__(self, doc, page, y0, y1, ph, pw):
        self.doc, self.page, self.y0, self.y1, self.ph, self.pw = doc, page, max(0.0, y0), min(ph, y1), ph, pw

    @property
    def h(self):
        return self.y1 - self.y0

    @property
    def full(self):
        return self.y0 <= 1 and self.y1 >= self.ph - 1

    def __repr__(self):
        return f"{self.doc}:p{self.page}[{self.y0:.0f},{self.y1:.0f})"


def span_regions(doc, pages, start, end):
    """(页, y) 区间 [start, end) 拆成每页一段"""
    out = []
    for pi in range(start[0], end[0] + 1):
        pg = pages[pi - 1]
        y0 = start[1] if pi == start[0] else 0
        y1 = end[1] if pi == end[0] else pg["height"]
        if y1 > y0:
            out.append(Region(doc, pi, y0, y1, pg["height"], pg["width"]))
    return out


def words_in(pages, r):
    return [w for w in pages[r.page - 1]["w"] if r.y0 <= (w[2] + w[4]) / 2 < r.y1]


def plan(pid, paper, pages, borrowed):
    """本套的卷面去掉"听力与前两套相同"那段，在原处插入借来的部分。返回区域列表和日志"""
    log = []
    secs = paper["sections"]
    first_own = next((s for s in secs if s["kind"] != "writing" and s.get("anchor")), None)
    end_doc = (len(pages), pages[-1]["height"])
    gaps = []  # [(start, end, [区域])]
    for sid, src_id, src_pages, src_paper in borrowed:
        sec = next(s for s in src_paper["sections"] if s["id"] == sid)
        nxt = src_paper["sections"][src_paper["sections"].index(sec) + 1]
        a, b = anchor_pos(sec), anchor_pos(nxt)
        if sid == "listening":
            # 那一套的听力：从 Part II 标题到 Part III 标题（找不到就到选词填空的 Section A）
            last_q = max((q["page"], q["box"][3]) for g in sec["groups"] for q in g["questions"])
            head = find_line(src_pages, last_q, b, is_reading_head)
            src_end = (head[0], head[1] - 3) if head else (b[0], b[1] - 3)
            # 本套：Part II 标题（和后面的说明）到 Part III 标题
            stop = anchor_pos(first_own)
            p3 = find_line(pages, (1, 0), stop, is_reading_head) or stop
            p2 = LISTEN_HEAD.get(pid) or find_line(pages, (1, 0), p3, is_listening_head)
            g0 = (p2[0], p2[1] - 3) if p2 else (p3[0], p3[1] - 3)
            g1 = (p3[0], p3[1] - 3)
            if not p2:
                log.append("本套卷面上没找到 Part II 标题，听力插在 Part III 前面")
        else:
            # 选词填空：从 Section A 到 Section B
            src_end = (b[0], b[1] - 3)
            stop = anchor_pos(first_own)
            p3 = find_line(pages, (1, 0), stop, is_reading_head)
            sa = find_line(pages, p3 or (1, 0), stop, lambda t: t.startswith("sectiona"))
            g0 = (sa[0], sa[1] - 3) if sa else (stop[0], stop[1] - 3)
            g1 = (stop[0], stop[1] - 3)
        src_regions = span_regions(src_id, src_pages, (a[0], a[1] - 3), src_end)
        gaps.append((g0, g1, src_regions))
        log.append(f"{sid}：借 {src_id} {src_regions}，本套去掉 {g0}→{g1}")
    gaps.sort(key=lambda g: g[0])
    regions, cur = [], (1, 0)
    for g0, g1, src_regions in gaps:
        regions += span_regions(pid, pages, cur, g0)
        regions += src_regions
        cur = max(cur, g1)
    regions += span_regions(pid, pages, cur, end_doc)
    return regions, log


def clipped(doc, r):
    """只留这一段文字的单页 PDF。show_pdf_page 嵌进去的是整页，clip 只管画哪一块，裁掉那部分的文字还在，
    取字（生成解析输入、导出后复制）时会混进来，所以先把段外的文字删掉（图片和线条不动，反正画不出来）"""
    tmp = fitz.open()
    tmp.insert_pdf(doc, from_page=r.page - 1, to_page=r.page - 1)
    pg = tmp[0]
    box = pg.rect
    if r.y0 > box.y0 + 0.5:
        pg.add_redact_annot(fitz.Rect(box.x0, box.y0, box.x1, r.y0))
    if r.y1 < box.y1 - 0.5:
        pg.add_redact_annot(fitz.Rect(box.x0, r.y1, box.x1, box.y1))
    pg.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE)
    return tmp


def has_ink(doc, r):
    """这一段卷面上有没有印东西（扫描件的标题常常没有文字层，只能看图）"""
    pix = doc[r.page - 1].get_pixmap(clip=fitz.Rect(0, r.y0, r.pw, r.y1), dpi=36, colorspace=fitz.csGRAY)
    return min(pix.samples) < 160 if pix.samples else False


def pack(regions, words_of, docs):
    """区域排成新页：整页单独一页；不满一页的相邻几段叠在一页里（总高不超过最大页高的 1.2 倍）。
    空白的段去掉"""
    regions = [r for r in regions if r.h >= 8 and (words_in(words_of[r.doc], r) or has_ink(docs[r.doc], r))]
    limit = 1.2 * max(r.ph for r in regions)
    out = []
    for r in regions:
        if out and not r.full and not out[-1][0].full and sum(x.h for x in out[-1]) + r.h <= limit:
            out[-1].append(r)
        else:
            out.append([r])
    return out


# ---------- 生成 ----------


def build(pid, dry=False):
    paper, pages, pdf_path = load_base(pid)
    cur = jload(PAPERS / f"{pid}.json")
    prev = next((x for x in cur.get("shared") or [] if x["section"] == "listening"), None)
    n, basis = choose_source(pid, paper, prev)
    src_id = sib_id(pid, n)
    src = jload(PAPERS / f"{src_id}.json")
    if src.get("shared") or not has_listening(src):
        raise SystemExit(f"{pid}：{src_id} 自己也没有听力")
    src_pages = jload(PDF / f"{src_id}.words.json")["pages"]
    borrowed = [("listening", src_id, src_pages, src)]
    extra_notes = []
    for sid, m, why in EXTRA.get(pid, []):
        eid = sib_id(pid, m)
        ep = jload(PAPERS / f"{eid}.json")
        borrowed.append((sid, eid, jload(PDF / f"{eid}.words.json")["pages"], ep))
        extra_notes.append((sid, eid, why))
    docs = {pid: fitz.open(pdf_path)}
    words_of = {pid: pages}
    for _, bid, bpages, _ in borrowed:
        docs.setdefault(bid, fitz.open(PDF / f"{bid}.pdf"))
        words_of[bid] = bpages

    regions, log = plan(pid, paper, pages, borrowed)
    layout = pack(regions, words_of, docs)

    # 新卷面
    out = fitz.open()
    new_pages = []
    where = {}  # (doc, 原页) -> [(y0, y1, 新页, 偏移)]
    for i, group in enumerate(layout):
        W = max(r.pw for r in group)
        H = sum(r.h for r in group)
        op = out.new_page(width=W, height=H)
        npg = {"width": round(W, 1), "height": round(H, 1), "w": [], "s": []}
        off = 0.0
        for r in group:
            if r.full:
                op.show_pdf_page(fitz.Rect(0, off, r.pw, off + r.h), docs[r.doc], r.page - 1)
            else:
                op.show_pdf_page(fitz.Rect(0, off, r.pw, off + r.h), clipped(docs[r.doc], r), 0, clip=fitz.Rect(0, r.y0, r.pw, r.y1))
            src_pg = words_of[r.doc][r.page - 1]
            smap = {}
            for w in words_in(words_of[r.doc], r):
                si = w[5]
                if si not in smap:
                    smap[si] = len(npg["s"])
                    npg["s"].append(src_pg["s"][si] if si < len(src_pg["s"]) else "")
                npg["w"].append([w[0], w[1], round(w[2] - r.y0 + off, 1), w[3], round(w[4] - r.y0 + off, 1), smap[si]])
            where.setdefault((r.doc, r.page), []).append((r.y0, r.y1, i + 1, off - r.y0))
            off += r.h
        new_pages.append(npg)

    def move(doc, pb, what):
        """{page, box} 搬到新卷面上"""
        cy = (pb["box"][1] + pb["box"][3]) / 2
        cands = where.get((doc, pb["page"]), [])
        hit = next((c for c in cands if c[0] - 2 <= cy < c[1] + 2), None)
        if not hit:
            raise SystemExit(f"{pid}：{what}（{doc} 第 {pb['page']} 页 y={cy:.0f}）不在新卷面上")
        _, _, np_, dy = hit
        pb["page"] = np_
        pb["box"] = [pb["box"][0], round(pb["box"][1] + dy, 1), pb["box"][2], round(pb["box"][3] + dy, 1)]

    def move_section(doc, sec):
        if sec.get("anchor"):
            move(doc, sec["anchor"], f"{sec['id']} 标题")
        for g in sec["groups"]:
            if g.get("anchor"):
                move(doc, g["anchor"], f"{g['id']} 播放位置")
            for q in g["questions"]:
                if q.get("page") and q.get("box"):
                    move(doc, q, q["id"])
                if q.get("blank"):
                    move(doc, q["blank"], f"{q['id']} 空位")

    new = copy.deepcopy(paper)
    for s in new["sections"]:
        move_section(pid, s)
    shared = []
    for sid, bid, _, bp in borrowed:
        sec = copy.deepcopy(next(s for s in bp["sections"] if s["id"] == sid))
        move_section(bid, sec)
        sec["from"] = bid
        if sid == "listening":
            pos = next((i + 1 for i, s in enumerate(new["sections"]) if s["kind"] == "writing"), 0)
            new["audio"] = copy.deepcopy(bp["audio"])
            shared.append({"section": sid, "from": bid, "basis": basis})
        else:
            pos = next(i for i, s in enumerate(new["sections"]) if s["kind"] in ("matching", "reading"))
            why = next(w for x, e, w in extra_notes if x == sid)
            shared.append({"section": sid, "from": bid, "basis": why})
        new["sections"].insert(pos, sec)
    ids = [q["id"] for s in new["sections"] for g in s["groups"] for q in g["questions"]]
    gids = [g["id"] for s in new["sections"] for g in s["groups"]]
    if len(ids) != len(set(ids)) or len(gids) != len(set(gids)):
        raise SystemExit(f"{pid}：接进来的题目或题组 id 和本套重复")
    new["shared"] = shared
    note = paper.get("note", "").replace("本套卷面没有列出听力，听力与同场另一套相同。", "")
    note = re.sub(r"本套卷面没有印选词填空（与同场另一套相同），只有段落匹配和仔细阅读。", "", note)
    m = int(src_id[-1])
    note += f"原卷没有印听力（真考时和同场第 {m} 套是同一份录音，只是选项顺序不同），这里接上了第 {m} 套的听力卷面、答案和录音。"
    for sid, bid, _ in extra_notes:
        note += f"选词填空也没印（和第 {bid[-1]} 套相同），接上了第 {bid[-1]} 套的。"
    new["note"] = note

    if dry:
        return new, layout, log, None
    # 写文件
    out.save(PDF / f"{pid}.pdf", garbage=3, deflate=True, linear=True)
    (PDF / f"{pid}.words.json").write_text(json.dumps({"pages": new_pages}, ensure_ascii=False, separators=(",", ":")), "utf-8")
    jsave(PAPERS / f"{pid}.json", new)
    ex = relink_explain(pid, new, new_pages, borrowed)
    return new, layout, log, ex


def relink_explain(pid, paper, pages, borrowed):
    """解析层：借来的题照抄那一套的；本套和借来的阅读题都按 quote 在新卷面上重新定位（page、words）"""
    ep = EXPLAIN / f"{pid}.json"
    layer = jload(ep) if ep.exists() else {"id": pid, "questions": {}, "groups": {}}
    raw = ep.read_bytes() if ep.exists() else b""
    copied = 0
    for sid, bid, _, bp in borrowed:
        bl_path = EXPLAIN / f"{bid}.json"
        if not bl_path.exists():
            continue
        bl = jload(bl_path)
        sec = next(s for s in bp["sections"] if s["id"] == sid)
        for g in sec["groups"]:
            if g["id"] in (bl.get("groups") or {}):
                layer.setdefault("groups", {})[g["id"]] = copy.deepcopy(bl["groups"][g["id"]])
            for q in g["questions"]:
                if q["id"] in bl["questions"]:
                    layer["questions"][q["id"]] = copy.deepcopy(bl["questions"][q["id"]])
                    copied += 1
    found = lost = 0
    spans = {s["id"]: (p0, p1) for s, p0, y0, p1, y1 in section_spans(paper)}
    for s in paper["sections"]:
        if s["kind"] == "listening":
            continue
        p0, p1 = spans.get(s["id"], (None, None))
        hint = set(range(p0, min(p1, len(pages)) + 1)) if p0 else None
        for g in s["groups"]:
            for q in g["questions"]:
                loc = ((layer["questions"].get(q["id"]) or {}).get("fields") or {}).get("locate")
                if not isinstance(loc, dict) or not loc.get("quote"):
                    continue
                hit = find_quote_on_pages(loc["quote"], pages, hint) or (find_quote_on_pages(loc["quote"], pages) if hint else None)
                if hit:
                    loc["page"], loc["words"] = hit[0], hit[1]
                    found += 1
                else:
                    loc.pop("page", None)
                    loc.pop("words", None)
                    lost += 1
    nl = "\r\n" if b"\r\n" in raw else "\n"
    with open(ep, "w", encoding="utf-8", newline=nl) as f:
        json.dump(layer, f, ensure_ascii=False, indent=1)
    return {"copied": copied, "found": found, "lost": lost}


# ---------- 核对 ----------


def check(pid):
    """新卷面上每个有文字层的词，按 words.json 的位置从 PDF 里取字，看是不是同一个词"""
    doc = fitz.open(PDF / f"{pid}.pdf")
    pages = jload(PDF / f"{pid}.words.json")["pages"]
    tot = ok = 0
    for i, pg in enumerate(pages):
        page = doc[i]
        if abs(page.rect.width - pg["width"]) > 1 or abs(page.rect.height - pg["height"]) > 1:
            print(f"  {pid} 第 {i + 1} 页尺寸不一致")
        pw = page.get_text("words")
        if len(pw) < 20:
            continue  # 扫描页没有文字层，只能看图
        for w in pg["w"][::7]:
            cx, cy = (w[1] + w[3]) / 2, (w[2] + w[4]) / 2
            got = [x[4] for x in pw if x[0] - 1 <= cx <= x[2] + 1 and x[1] - 1 <= cy <= x[3] + 1]
            tot += 1
            key = re.sub(r"[^A-Za-z]", "", w[0]).lower()
            if any(key and key[:4] in re.sub(r"[^A-Za-z]", "", g).lower() for g in got) or not key:
                ok += 1
    return tot, ok


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    fitz.TOOLS.mupdf_display_errors(False)
    ap = argparse.ArgumentParser(description="四六级第 3 套接上同场另一套的听力")
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--dry-run", action="store_true", help="只打印怎么拼，不写文件")
    ap.add_argument("--check", action="store_true", help="只核对已经生成的卷面")
    args = ap.parse_args()
    ids = args.ids or targets()
    if args.check:
        for pid in ids:
            tot, ok = check(pid)
            print(f"{pid}  抽查 {tot} 个词，对上 {ok}" + ("" if tot == 0 or ok / tot > 0.97 else "  ← 要看"))
        return
    for pid in ids:
        new, layout, log, ex = build(pid, dry=args.dry_run)
        sh = "；".join(f"{x['section']} ← {x['from']}（{x['basis']}）" for x in new["shared"])
        print(f"{pid}  {len(layout)} 页  {sh}")
        if args.dry_run:
            for line in log:
                print("    " + line)
            for i, g in enumerate(layout):
                print(f"    新第 {i + 1} 页：{g}")
        elif ex:
            print(f"    解析层：抄来 {ex['copied']} 条，本套定位 {ex['found']} 条" + (f"，没定位上 {ex['lost']} 条" if ex["lost"] else ""))
    if not args.dry_run:
        print("\n接完运行 npm run check:papers、npm run thumbs、npm run build")


if __name__ == "__main__":
    main()
