"""长难句解析层 public/papers/syntax/<id>.json（格式见 docs/设计任务-J轮-长难句.md §1）。

只收四六级仔细阅读（kind 为 reading 的部分，四六级是 Section C 的两篇）文章里的句子。句子取自卷面
words.json 的 pages[].s，键和译文层一样用 trans_key()（界面按句子键把卷面上的句子对上解析）。

解析由 AI 子代理逐句写，脚本只管列句子、校验、合并、出文件，可以反复跑：

  python -I scripts/build_syntax.py status [id ...]            每套各篇有几句、已解析几句
  python -I scripts/build_syntax.py todo DIR [id ...] [--min 22]
        每套写一个 DIR/<id>.in.txt：按篇列出文章里的每一句，"键<TAB>题组<TAB>词数<TAB>英文"，
        词数 ≥ --min 的行首标 *（候选，子代理从里面挑真正难的，每篇 3–6 句；没标 * 的也可以挑）；
        已经解析过的句子不列。子代理照着写 DIR/<id>.out.json：{"键": {条目}, ...}
  python -I scripts/build_syntax.py check DIR ID               只校验 DIR/ID.out.json，不写文件（子代理自查用）
  python -I scripts/build_syntax.py merge DIR [id ...]         校验通过的条目写进 syntax/<id>.json，不通过的列出来
  python -I scripts/build_syntax.py show ID                    打印一套已有的解析，人工看

条目（out.json 里每句一个，group 和 en 由脚本补，不用写）：
  {"main": [{"t": "researchers", "r": "主语"}, {"t": "assumed", "r": "谓语"}, {"t": "that …", "r": "宾语"}],
   "parts": [{"t": "who studied how children learn to read", "r": "定语从句", "of": "researchers"}],
   "points": ["that 引导宾语从句，从句里 once 引导时间状语从句"],
   "zh": "几十年来，……"}

校验：键必须是这套仔细阅读里的句子；main 2–5 项、parts 0–6 项，每项 t 原样出现在句子里（大小写、空白不计），
main 按句子里的先后顺序排；r 只能用 ROLES 里的说法；of 要出现在句子里；points 1–3 条、每条 ≤ 60 字；
zh 有汉字、汉字数在英文字符数的 15%–120%；每篇最多 8 句。
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from trans_key import trans_key, trans_norm  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PAPERS = ROOT / "public" / "papers"
OUT = PAPERS / "syntax"
VERSION = 1
PER_GROUP = 8

MAIN_ROLES = {"主语", "谓语", "宾语", "间接宾语", "表语", "宾语补足语", "形式主语", "真正主语", "形式宾语", "真正宾语"}
PART_ROLES = {
    "定语从句", "非限制性定语从句", "同位语从句", "宾语从句", "主语从句", "表语从句",
    "时间状语从句", "条件状语从句", "原因状语从句", "让步状语从句", "目的状语从句", "结果状语从句",
    "比较状语从句", "方式状语从句", "地点状语从句",
    "现在分词短语", "过去分词短语", "不定式短语", "动名词短语", "独立主格",
    "介词短语", "同位语", "插入语", "并列成分", "倒装", "强调句", "省略",
}
ROLES = MAIN_ROLES | PART_ROLES
HEAD = re.compile(r"^(Passage (One|Two|Three)|Questions? \d|Section [ABC]|Part [IVX]+|Directions)", re.I)
# 仔细阅读的固定指导语（"Each passage is followed by some questions…"）
BOILER = re.compile(r"passages? in this section|each passage is followed by|there are \d+ choices|decide on the best choice|mark the corresponding letter|answer sheet", re.I)
EN_WORD = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?")
CJK = re.compile(r"[一-鿿]")


def jload(p):
    return json.loads(Path(p).read_text("utf-8"))


def jsave(p, data):
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")
    tmp.replace(p)


def paper_ids():
    return sorted(p.stem for p in PAPERS.glob("*.json") if p.name != "index.json")


def squash(t):
    return re.sub(r"\s+", " ", t or "").strip()


def passage_head(pages, after):
    """after (页, y) 之后第一个"Passage One/Two/Three"标题的 (页, y)；找不到返回 None"""
    p0, y0 = after
    for pno in range(p0, len(pages) + 1):
        w = pages[pno - 1]["w"]
        for i in range(len(w) - 1):
            if w[i][0] == "Passage" and w[i + 1][0] in ("One", "Two", "Three") and (pno > p0 or w[i][2] >= y0):
                return (pno, w[i][2] - 1)
    return None


def reading_groups(paper, pages):
    """[(题组, 起点 (页, y), 终点 (页, y))]：文章在卷面上的范围是从这一篇的起点到它第一题的题号之前。
    起点：第一篇是这一部分的标题，后面的是上一篇最后一题之后的"Passage Two"标题（跳过上一篇的题干和选项，
    多句的选项拆出来的后半句没有 A) 开头，不能按句子过滤）；找不到标题才退到上一篇最后一题的题号"""
    out = []
    for sec in paper["sections"]:
        if sec.get("kind") != "reading":
            continue
        a = sec.get("anchor")
        prev = (a["page"], a["box"][1] - 2) if a else None
        for g in sec["groups"]:
            qs = [q for q in g["questions"] if q.get("page") and q.get("box")]
            if not qs or not g.get("questions"):
                continue
            first, last = qs[0], qs[-1]
            end = (first["page"], first["box"][1] - 1)
            start = prev or (first["page"], 0)
            if out:
                start = passage_head(pages, start) or start
            out.append((g, start, end))
            prev = (last["page"], last["box"][3])
    return out


def passage_sentences(pid):
    """[(键, 题组 id, 英文)]，按卷面顺序，同一句只收一次；只收文章里的句子（有 4 个以上英文词，不是标题、题干、选项）"""
    paper = jload(PAPERS / f"{pid}.json")
    wp = PAPERS / "pdf" / f"{pid}.words.json"
    if not wp.exists():
        return []
    pages = jload(wp)["pages"]
    out, seen = [], set()
    for g, (p0, y0), (p1, y1) in reading_groups(paper, pages):
        for pno in range(p0, p1 + 1):
            if pno > len(pages):
                break
            page = pages[pno - 1]
            sids = []
            for w in page["w"]:
                y = (w[2] + w[4]) / 2
                if (pno == p0 and y < y0) or (pno == p1 and y >= y1):
                    continue
                if w[5] not in sids:
                    sids.append(w[5])
            for sid in sids:
                t = squash(page["s"][sid] if sid < len(page["s"]) else "")
                if len(EN_WORD.findall(t)) < 4 or HEAD.match(t) or BOILER.search(t) or re.match(r"^\d{1,2}\s*[.．]|^[A-D]\)", t):
                    continue
                k = trans_key(t)
                if k in seen:
                    continue
                seen.add(k)
                out.append((k, g["id"], t))
    return out


def load_layer(pid):
    p = OUT / f"{pid}.json"
    return jload(p) if p.exists() else {"id": pid, "by": "ai", "version": VERSION, "sentences": {}}


def find_ci(hay, needle, start=0):
    """在句子里找片段（大小写、空白、弯引号不计），返回 (起, 止) 或 None"""
    def fold(s):
        return re.sub(r"\s+", " ", s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')).lower()
    h, n = fold(hay), fold(squash(needle))
    if not n:
        return None
    # 整词匹配（"is" 不能匹配到 "this" 里），和界面 src/lib/syntax.ts 的 locate() 一致
    m = re.compile(r"(?<![a-z0-9])" + re.escape(n) + r"(?![a-z0-9])").search(h, start)
    return (m.start(), m.end()) if m else None


def check_entry(en, e):
    """返回问题列表；没问题是空列表"""
    errs = []
    if not isinstance(e, dict):
        return ["不是对象"]
    main = e.get("main")
    if not isinstance(main, list) or not 2 <= len(main) <= 5:
        errs.append("main 要 2–5 项")
        main = main if isinstance(main, list) else []
    pos = 0
    for m in main:
        if not isinstance(m, dict) or m.get("r") not in MAIN_ROLES:
            errs.append(f"main 的成分名不对：{m.get('r') if isinstance(m, dict) else m}")
            continue
        at = find_ci(en, m.get("t", ""), pos)
        if not at:
            errs.append(f"main「{m.get('t')}」不在句子里（或顺序不对）")
        else:
            pos = at[1]
    parts = e.get("parts", [])
    if not isinstance(parts, list) or len(parts) > 6:
        errs.append("parts 最多 6 项")
        parts = []
    for p in parts:
        if not isinstance(p, dict) or p.get("r") not in PART_ROLES:
            errs.append(f"parts 的成分名不对：{p.get('r') if isinstance(p, dict) else p}")
            continue
        if not find_ci(en, p.get("t", "")):
            errs.append(f"parts「{p.get('t')}」不在句子里")
        if p.get("of") and not find_ci(en, p["of"]):
            errs.append(f"parts 的 of「{p['of']}」不在句子里")
    pts = e.get("points")
    if not isinstance(pts, list) or not 1 <= len(pts) <= 3 or any(not isinstance(x, str) or not x.strip() or len(x) > 60 for x in pts):
        errs.append("points 要 1–3 条、每条 ≤ 60 字")
    zh = e.get("zh")
    if not isinstance(zh, str) or len(CJK.findall(zh)) < 2:
        errs.append("zh 没有汉字")
    else:
        n, m = len(CJK.findall(zh)), len(en)
        if not 0.15 * m <= n <= 1.2 * m:
            errs.append(f"zh 长度不对（{n} 个汉字 / 英文 {m} 字符）")
    return errs


def clean_entry(e):
    keep = {"main": [{"t": squash(m["t"]), "r": m["r"]} for m in e["main"]]}
    keep["parts"] = [{k: squash(v) for k, v in p.items() if k in ("t", "r", "of", "note") and v} for p in e.get("parts", [])]
    keep["points"] = [squash(x) for x in e["points"]]
    keep["zh"] = squash(e["zh"])
    return keep


def validate(pid, raw):
    """(通过的 {键: 条目}, 问题 [(键, 说明)])；合并进已有的解析后某篇超过 PER_GROUP 句也算问题（check 和 merge 一个标准）"""
    sents = {k: (g, t) for k, g, t in passage_sentences(pid)}
    ok, bad = {}, []
    for k, e in raw.items():
        if k not in sents:
            bad.append((k, "键不是这套仔细阅读里的句子"))
            continue
        errs = check_entry(sents[k][1], e)
        if errs:
            bad.extend((k, x) for x in errs)
            continue
        ok[k] = {"group": sents[k][0], "en": sents[k][1], **clean_entry(e)}
    per = {}
    for e in {**load_layer(pid)["sentences"], **ok}.values():
        per[e["group"]] = per.get(e["group"], 0) + 1
    for g, n in per.items():
        if n > PER_GROUP:
            bad.append(("-", f"{g} 合并后 {n} 句，超过每篇 {PER_GROUP} 句"))
    return ok, bad


def cmd_status(ids):
    for pid in ids:
        sents = passage_sentences(pid)
        if not sents:
            continue
        have = load_layer(pid)["sentences"]
        groups = {}
        for k, g, _ in sents:
            n = groups.setdefault(g, [0, 0])
            n[0] += 1
            n[1] += k in have
        print(pid, "  ".join(f"{g} {b}/{a}" for g, (a, b) in groups.items()))


def cmd_todo(work, ids, min_words):
    work.mkdir(parents=True, exist_ok=True)
    for pid in ids:
        sents = passage_sentences(pid)
        if not sents:
            continue
        have = load_layer(pid)["sentences"]
        rows = [(k, g, t) for k, g, t in sents if k not in have]
        if not rows:
            continue
        lines = [f"{'*' if len(EN_WORD.findall(t)) >= min_words else ' '}{k}\t{g}\t{len(EN_WORD.findall(t))}\t{t}" for k, g, t in rows]
        (work / f"{pid}.in.txt").write_text("\n".join(lines) + "\n", "utf-8")
        print(pid, len(rows), "句，候选", sum(1 for x in lines if x.startswith("*")))


def cmd_check(work, pid):
    raw = jload(work / f"{pid}.out.json")
    ok, bad = validate(pid, raw)
    for k, why in bad:
        print(f"  {k}: {why}")
    print(pid, f"通过 {len(ok)}，有问题 {len({k for k, _ in bad})}")
    return not bad


def cmd_merge(work, ids):
    for f in sorted(work.glob("*.out.json")):
        pid = f.name[: -len(".out.json")]
        if ids and pid not in ids:
            continue
        ok, bad = validate(pid, jload(f))
        over = [why for k, why in bad if k == "-"]
        if over:
            print(pid, "不写：" + "；".join(over))
            continue
        layer = load_layer(pid)
        layer["sentences"].update(ok)
        order = {k: i for i, (k, _, _) in enumerate(passage_sentences(pid))}
        layer["sentences"] = dict(sorted(layer["sentences"].items(), key=lambda kv: order.get(kv[0], 1e9)))
        if ok:
            jsave(OUT / f"{pid}.json", layer)
        for k, why in bad:
            print(f"  {k}: {why}")
        print(pid, f"写入 {len(ok)}，有问题 {len({k for k, _ in bad})}，共 {len(layer['sentences'])} 句")


def cmd_show(pid):
    for k, e in load_layer(pid)["sentences"].items():
        print(f"[{e['group']}] {k} {e['en']}")
        print("   主干：" + " | ".join(f"{m['r']} {m['t']}" for m in e["main"]))
        for p in e["parts"]:
            print(f"   {p['r']}：{p['t']}" + (f"（修饰 {p['of']}）" if p.get("of") else ""))
        for x in e["points"]:
            print("   · " + x)
        print("   " + e["zh"])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("status"); s.add_argument("ids", nargs="*")
    s = sub.add_parser("todo"); s.add_argument("dir"); s.add_argument("ids", nargs="*"); s.add_argument("--min", type=int, default=22)
    s = sub.add_parser("check"); s.add_argument("dir"); s.add_argument("id")
    s = sub.add_parser("merge"); s.add_argument("dir"); s.add_argument("ids", nargs="*")
    s = sub.add_parser("show"); s.add_argument("id")
    a = ap.parse_args()
    ids = getattr(a, "ids", None) or paper_ids()
    if a.cmd == "status":
        cmd_status(ids)
    elif a.cmd == "todo":
        cmd_todo(Path(a.dir), ids, a.min)
    elif a.cmd == "check":
        sys.exit(0 if cmd_check(Path(a.dir), a.id) else 1)
    elif a.cmd == "merge":
        cmd_merge(Path(a.dir), getattr(a, "ids", None))
    elif a.cmd == "show":
        cmd_show(a.id)


if __name__ == "__main__":
    main()
