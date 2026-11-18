"""长难句解析层（拆句子，2026-11-15）：public/papers/parse/<id>.json。先只做六级仔细阅读。

句子：六级 Part III Section C 两篇文章的正文句（public/papers/pdf/<id>.words.json 的 pages[].s，
从 "Questions 46 to 50 are based on the following passage." 之后到第一道题 "46." 之前），
够长的（英文词数 >= --min，默认 20）才解析；整篇正文作为上下文一起给出。键用 trans_key.py（和句子译文同一个键）。

解析由外部 AI（Gemini）写，脚本只管列句子、校验、合并、出文件，可以反复跑：
  python -I scripts/build_parse.py todo [--min 20]     每套卷写一个 data/parse/in/<id>.txt（已在总库里的句子不再列；同一句只列一次）
  python -I scripts/build_parse.py check <id>          校验 data/parse/out/<id>.json，不写总库（AI 自查用）
  python -I scripts/build_parse.py show <id>           把交回的解析排成好读的样子（人工抽查）
  python -I scripts/build_parse.py status              每套：待解析几句、交回几句、通过几句
  python -I scripts/build_parse.py merge               校验 data/parse/out/*.json，通过的句子进总库 data/cache/parse/pool.json
  python -I scripts/build_parse.py write               按总库写出 public/papers/parse/<id>.json

每句的格式见 data/parse/任务书.md。校验：
  - chunks 按顺序拼起来，只看英文字母组成的词，要和原句一模一样（不漏、不重、不换序；标点、乱码、夹杂的数字不算）
  - role 只能是 ROLES 里的；level 0–3；zh 含汉字
  - core（主干）的词要按顺序出现在原句里，可以用 …… 省掉从句内容；core_zh 含汉字
  - tips 0–2 条，含汉字
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from trans_key import trans_key  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PAPERS = ROOT / "public" / "papers"
OUT_DIR = PAPERS / "parse"
WORK = ROOT / "data" / "parse"
IN = WORK / "in"
DONE = WORK / "out"
POOL = ROOT / "data" / "cache" / "parse" / "pool.json"
VERSION = 1

ROLES = {
    # 主句里的成分
    "主语", "谓语", "宾语", "表语", "补语", "状语",
    # 从句
    "主语从句", "宾语从句", "表语从句", "同位语从句", "定语从句", "状语从句",
    # 其他
    "后置定语", "同位语", "插入语", "连接词",
}
LETTERS = re.compile(r"[a-z]+")
CJK = re.compile(r"[一-鿿]")
MARK = re.compile(r"questions?\s*(\d+)\s*(?:to|and|-)\s*(\d+)\s*(?:are|is)?\s*based", re.I)


def letters(text: str) -> list:
    """只留英文字母组成的词（小写）：比对和对到卷面上的词都用它"""
    return LETTERS.findall((text or "").lower().replace("’", "'"))


def show(s: str) -> str:
    """给 AI 看的写法：乱码的引号换回引号、乱码的破折号换回破折号。校验只看字母，不受影响"""
    s = re.sub("�+", '"', s)
    s = s.replace("һ", "—")
    s = re.sub(r"^\s*\d+\s+\d+\s+(?=[A-Z])", "", s)  # 打乱的标记里漏下来的题号（"51 55 Every five years…"）
    return re.sub(r"\s+", " ", s).strip()


def passages(pid: str) -> list:
    """一套六级卷仔细阅读的文章：[(题号起, [句子…]), …]"""
    paper = json.loads((PAPERS / f"{pid}.json").read_text("utf-8"))
    secs = paper.get("sections") or []
    rd = [s for s in secs if s.get("kind") == "reading" and (s.get("anchor") or {}).get("page")]
    tr = [s for s in secs if s.get("kind") == "translation" and (s.get("anchor") or {}).get("page")]
    wf = PAPERS / "pdf" / f"{pid}.words.json"
    if not rd or not wf.exists():
        return []
    p0 = rd[0]["anchor"]["page"]
    p1 = tr[0]["anchor"]["page"] if tr else 99
    pages = json.loads(wf.read_text("utf-8"))["pages"]
    sents = [s for i in range(p0, min(p1, len(pages)) + 1) for s in (pages[i - 1].get("s") or [])]
    out, cur, first = [], None, None
    for s in sents:
        # 文章开头的标记。识别常把它打乱（"Questions to are based"、"51 to SS"、粘在上一道题的选项后面），
        # 所以先认 Passage One/Two（六级仔细阅读固定是 46–50、51–55），认不出再认 "Questions 46 to 50"
        m = re.search(r"\bPassage\s+(One|Two)\b", s, re.I)
        n = (46 if m.group(1).lower() == "one" else 51) if m else (int(MARK.search(s).group(1)) if MARK.search(s) else None)
        if n:
            if cur:
                out.append((first, cur))
            first, cur = n, []
            continue
        if cur is None:
            continue
        # 到第一道题（"46."）或选项、下一部分就停
        if re.match(rf"^\s*{first}\s*[.．,]", s) or re.match(r"^\s*[A-D]\s*\)", s) or re.match(r"^\s*Part\s+I", s):
            out.append((first, cur))
            cur = None
            continue
        if len(letters(s)) < 4 or len(CJK.findall(s)) > 2:  # 页脚、页码
            continue
        cur.append(s)
    if cur:
        out.append((first, cur))
    return out


def cet6_ids() -> list:
    return sorted(p.stem for p in PAPERS.glob("cet6-*.json"))


def load_pool() -> dict:
    return json.loads(POOL.read_text("utf-8")) if POOL.exists() else {}


def read_todo(pid: str) -> dict:
    """data/parse/in/<id>.txt 里要解析的句子：{键: 原句}"""
    f = IN / f"{pid}.txt"
    todo, on = {}, False
    for line in f.read_text("utf-8").splitlines():
        if line.startswith("=== 要解析的句子"):
            on = True
            continue
        if line.startswith("==="):
            on = False
            continue
        if on and "\t" in line:
            k, s = line.split("\t", 1)
            todo[k.strip()] = s
    return todo


def cmd_todo(args):
    pool = load_pool()
    IN.mkdir(parents=True, exist_ok=True)
    DONE.mkdir(parents=True, exist_ok=True)
    seen = set(pool)
    files = sents = 0
    odd = []
    for pid in cet6_ids():
        ps = passages(pid)
        if not ps:
            continue
        if len(ps) != 2:
            odd.append(f"{pid}（{len(ps)} 篇）")
        blocks, n = [], 0
        for i, (first, ss) in enumerate(ps):
            want = []
            for s in ss:
                k = trans_key(s)
                if len(letters(s)) >= args.min and k not in seen:
                    seen.add(k)
                    want.append((k, show(s)))
            if not want:
                continue
            name = ["Passage One", "Passage Two"][i] if i < 2 else f"Passage {i + 1}"
            blocks.append(f"=== {pid} {name}（Questions {first}–{first + 4}）全文，只作上下文 ===\n" + " ".join(show(s) for s in ss))
            blocks.append("=== 要解析的句子（键<TAB>原句）===\n" + "\n".join(f"{k}\t{s}" for k, s in want))
            n += len(want)
        f = IN / f"{pid}.txt"
        if n:
            f.write_text("\n\n".join(blocks) + "\n", "utf-8")
            files += 1
            sents += n
        elif f.exists():
            f.unlink()
    print(f"写了 {files} 个文件，共 {sents} 句要解析（词数 >= {args.min}），在 {IN}")
    if odd:
        print("篇数不是 2 的（文章切分可能有问题，看一下）：" + "、".join(odd))


def check_one(todo: dict, data) -> tuple:
    """返回 (通过的 {键: 解析}, 问题列表)"""
    ok, errs = {}, []
    if not isinstance(data, dict):
        return ok, ["整个文件应该是一个 JSON 对象 {键: 解析}"]
    for k in data:
        if k not in todo:
            errs.append(f"{k}：不是这个文件里要解析的键")
    for k, sent in todo.items():
        a = data.get(k)
        if a is None:
            errs.append(f"{k}：缺这一句")
            continue
        e = []
        if not isinstance(a, dict):
            errs.append(f"{k}：应该是对象")
            continue
        chunks = a.get("chunks")
        if not isinstance(chunks, list) or not 2 <= len(chunks) <= 14:
            e.append("chunks 要 2–14 块")
            chunks = []
        joined = []
        for i, c in enumerate(chunks):
            if not isinstance(c, dict):
                e.append(f"第 {i + 1} 块不是对象")
                continue
            joined += letters(c.get("text", ""))
            if c.get("role") not in ROLES:
                e.append(f"第 {i + 1} 块 role「{c.get('role')}」不在规定的 16 个里")
            if c.get("level") not in (0, 1, 2, 3):
                e.append(f"第 {i + 1} 块 level 要是 0–3")
            if not CJK.search(str(c.get("zh", ""))) or len(str(c.get("zh", ""))) > 80:
                e.append(f"第 {i + 1} 块 zh 要有中文、不超过 80 字")
            if len(str(c.get("note", ""))) > 20:
                e.append(f"第 {i + 1} 块 note 不超过 20 字")
        want = letters(sent)
        if chunks and joined != want:
            # 指出第一处对不上的地方
            j = next((i for i, (x, y) in enumerate(zip(joined, want)) if x != y), min(len(joined), len(want)))
            e.append(f"chunks 拼起来和原句对不上：第 {j + 1} 个词起，原句是「{' '.join(want[j:j + 5])}」，chunks 是「{' '.join(joined[j:j + 5])}」")
        core = letters(str(a.get("core", "")))
        it = iter(want)
        if not core or not all(w in it for w in core):
            e.append("core 的词要按顺序出现在原句里（从句可以用 …… 省掉）")
        if not CJK.search(str(a.get("core_zh", ""))):
            e.append("core_zh 要有中文")
        tips = a.get("tips", [])
        if not isinstance(tips, list) or len(tips) > 2 or any(not CJK.search(str(t)) or len(str(t)) > 100 for t in tips):
            e.append("tips 是 0–2 条中文，每条不超过 100 字")
        if e:
            errs += [f"{k}：{x}" for x in e]
        else:
            ok[k] = {
                "core": a["core"].strip(),
                "core_zh": a["core_zh"].strip(),
                "chunks": [{kk: c[kk] for kk in ("text", "role", "level", "note", "zh") if c.get(kk) not in (None, "")} for c in chunks],
                "tips": [str(t).strip() for t in tips],
            }
    return ok, errs


def load_out(pid: str):
    f = DONE / f"{pid}.json"
    if not f.exists():
        return None, f"没有 {f}"
    text = f.read_text("utf-8").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)  # 网页版常带 ```json 包着
    try:
        return json.loads(text), None
    except json.JSONDecodeError as ex:
        return None, f"{f.name} 不是合法 JSON：{ex}"


def cmd_check(args):
    todo = read_todo(args.id)
    data, err = load_out(args.id)
    if err:
        print(err)
        sys.exit(1)
    ok, errs = check_one(todo, data)
    print(f"{args.id}：要解析 {len(todo)} 句，通过 {len(ok)} 句")
    for e in errs:
        print("  " + e)
    sys.exit(1 if errs else 0)


def cmd_show(args):
    """把交回的解析排成好读的样子，人工抽查用"""
    todo = read_todo(args.id)
    data, err = load_out(args.id)
    if err:
        print(err)
        sys.exit(1)
    for k, sent in todo.items():
        a = data.get(k) if isinstance(data, dict) else None
        print(f"\n【{k}】{sent}")
        if not isinstance(a, dict):
            print("  （没有解析）")
            continue
        print(f"  主干：{a.get('core', '')}　＝　{a.get('core_zh', '')}")
        for c in a.get("chunks") or []:
            if isinstance(c, dict):
                note = f"（{c['note']}）" if c.get("note") else ""
                print(f"  {'    ' * int(c.get('level') or 0)}· {c.get('text', '')}　〔{c.get('role', '')}{note}〕　{c.get('zh', '')}")
        for t in a.get("tips") or []:
            print(f"  难点：{t}")


def cmd_status(args):
    tot = got = good = 0
    for f in sorted(IN.glob("*.txt")):
        todo = read_todo(f.stem)
        data, err = load_out(f.stem)
        ok = check_one(todo, data)[0] if data is not None else {}
        n_out = len(data) if isinstance(data, dict) else 0
        tot, got, good = tot + len(todo), got + n_out, good + len(ok)
        flag = "✓" if len(ok) == len(todo) else ("—" if data is None else "✗")
        print(f"{flag} {f.stem}：{len(todo)} 句，交回 {n_out}，通过 {len(ok)}" + (f"（{err}）" if err and data is None and DONE.joinpath(f.stem + '.json').exists() else ""))
    print(f"合计：要解析 {tot}，交回 {got}，通过 {good}；总库已有 {len(load_pool())}")


def cmd_merge(args):
    pool = load_pool()
    added = 0
    for f in sorted(DONE.glob("*.json")):
        if not (IN / f"{f.stem}.txt").exists():
            continue
        data, err = load_out(f.stem)
        if err:
            print(err)
            continue
        ok, errs = check_one(read_todo(f.stem), data)
        for k, a in ok.items():
            added += k not in pool
            pool[k] = a
        if errs:
            print(f"{f.stem}：{len(errs)} 处问题，这些句子没进总库（python -I scripts/build_parse.py check {f.stem} 看详情）")
    POOL.parent.mkdir(parents=True, exist_ok=True)
    POOL.write_text(json.dumps(pool, ensure_ascii=False, indent=0), "utf-8")
    print(f"新进总库 {added} 句，总库共 {len(pool)} 句")


def cmd_write(args):
    pool = load_pool()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    n = 0
    for pid in cet6_ids():
        got = {}
        for _, ss in passages(pid):
            for s in ss:
                k = trans_key(s)
                if k in pool:
                    got[k] = pool[k]
        f = OUT_DIR / f"{pid}.json"
        if got:
            f.write_text(json.dumps({"id": pid, "by": "ai", "version": VERSION, "sentences": got}, ensure_ascii=False, separators=(",", ":")), "utf-8")
            n += 1
    print(f"写出 {n} 套到 {OUT_DIR}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("todo")
    t.add_argument("--min", type=int, default=20)
    c = sub.add_parser("check")
    c.add_argument("id")
    sh = sub.add_parser("show")
    sh.add_argument("id")
    sub.add_parser("status")
    sub.add_parser("merge")
    sub.add_parser("write")
    args = ap.parse_args()
    {"todo": cmd_todo, "check": cmd_check, "show": cmd_show, "status": cmd_status, "merge": cmd_merge, "write": cmd_write}[args.cmd](args)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
