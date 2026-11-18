"""全局句子译文层 public/papers/trans/<id>.json（格式见 docs/设计任务-I轮-听力与译文与小窗.md §0.2）。

句子范围：卷面句子（public/papers/pdf/<id>.words.json 的 pages[].s）+ 听力原文句子（试卷 JSON 的
audio.segments[].lines[].text，指导语和 "Questions 1 and 2 are based on…" 不收，读题行收）。键用 trans_key.py。
少于 4 个英文词的不收；标题、题号、各部分的固定指导语不收（见 BOILER）。

译文由 AI 子代理写，脚本只管列句子、合并、校验、出文件。所有译文先进一个总库
data/cache/trans/pool.json（{键: {"en", "zh"}}），再按每套有哪些句子写出 trans/<id>.json——
第 3 套接来的听力、同一句在几套里出现，都只译一次。可以反复跑。

  python -I scripts/build_trans.py status [id ...]              每套句数、已有译文、还缺几句
  python -I scripts/build_trans.py todo DIR [id ...] [--chunk 300] [--limit N]
        把这些套还缺的句子（去重、按卷面顺序）切成 DIR/NNN.in.txt，每行 "键<TAB>英文"；
        --skip-pending-asr：还在本地识别队列里、马上要被重写的听力段先不收（写回后再补译）；
        子代理照着写 DIR/NNN.out.json：{"键": "中文", ...}
  python -I scripts/build_trans.py check DIR NNN                只校验 DIR/NNN.out.json，不写总库（子代理自查用）
  python -I scripts/build_trans.py merge DIR                    校验 DIR/*.out.json，通过的进总库，不通过的列出来
  python -I scripts/build_trans.py write [id ...]               按总库写出 trans/<id>.json（没有一句译文的套不写）
  python -I scripts/build_trans.py sample N [id ...]            随机抽 N 句（英文 + 译文）人工看

校验：键必须是待译清单里的；译文非空、含汉字、不是英文原样（去掉汉字后剩下的英文词不超过原句的一半）、
长度合理（汉字数在英文字符数的 8%–120% 之间）。
"""
import argparse
import json
import random
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from trans_key import trans_key  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PAPERS = ROOT / "public" / "papers"
TRANS = PAPERS / "trans"
POOL = ROOT / "data" / "cache" / "trans" / "pool.json"
VERSION = 1

EN_WORD = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?")
CJK = re.compile(r"[一-鿿]")
# 各部分的固定指导语（整句不收）。在"只留小写字母"的句子上比，识别噪声（"o f each"）也认得出
BOILER = [re.compile(p) for p in (
    r"questions?(?:and|to)(?:are|is)?basedon",
    r"inthissectionyouwillhear",
    r"attheendof(?:each|the)(?:newsreport|conversation|passage|recording|talk|lecture)",
    r"willbespoken(?:only)?once",
    r"afteryouhearaquestion",
    r"markthecorrespondingletter",
    r"answersheet",
    r"youshouldwriteatleast",
    r"youwillhaveminutes",
    r"forthispartyouareallowed",
    r"passagesinthissection",
    r"eachpassageisfollowedby",
    r"foreachofthemtherearefourchoices",
    r"youshoulddecideonthebestchoice",
    r"inthissectionthereisapassagewith",
    r"youarerequiredtoselectoneword",
    r"readthepassagethroughcarefully",
    r"eachchoiceinthebankisidentified",
    r"youmaynotuseanyofthewordsinthebank",
    r"youaregoingtoreadapassagewith",
    r"eachstatementcontainsinformationgivenin",
    r"identifytheparagraphfromwhich",
    r"youmaychooseaparagraphmorethanonce",
    r"eachparagraphismarkedwithaletter",
    r"answerthequestionsbymarking",
    r"translateapassagefromchineseintoenglish",
    r"pleasemarkthecorrespondingletter",
    r"youshouldwriteyouranswer",
)]
# 小句开头的部分标题（"Part II Listening Comprehension (25 minutes) Section A Directions:"），去掉再看剩下的
HEADER = re.compile(r"^(?:part[a-z]{1,4}?)?(?:listeningcomprehension|readingcomprehension|translation|writing)?(?:minutes)?(?:section[abc])?(?:directions)?")


def squash(t):
    return re.sub(r"[^a-z]", "", (t or "").lower())


def jload(p):
    return json.loads(Path(p).read_text("utf-8"))


def en_words(t):
    return EN_WORD.findall(t or "")


def is_garbage(t):
    """扫描乱码（翻译题中文原文被识别成的 "~~?±Tt~~*~¼" 之类）：两个字母以上的词里，词典词和专名不到一半"""
    import transcript_lint as TL

    toks = [w for w in TL.TOKEN.findall(t) if len(w) >= 2]
    if len(toks) < 4:
        return False
    ok = sum(1 for w in toks if TL.is_name(w) or TL.in_dict(w) or w.isupper())
    return ok / len(toks) < 0.5


def wanted(text):
    """收不收这句：按 . ? ! 切成小句，只要有一个小句（去掉开头的部分标题后）有 4 个以上英文词、又不是固定指导语，就收整句"""
    t = (text or "").strip()
    if len(en_words(t)) < 4:
        return False
    if is_garbage(t):
        return False
    for part in re.split(r"(?<=[.?!])\s+", t):
        if len(en_words(part)) < 4:
            continue
        sq = HEADER.sub("", squash(part))
        if len(sq) < 15:
            continue
        if not any(r.search(sq) for r in BOILER):
            return True
    return False


def catalog_ids():
    return [x["id"] for x in jload(PAPERS / "index.json")]


def pending_asr_segments():
    """还在本地识别队列里、马上要被重写的听力段 {(试卷 id, 段 id)}（第 3 套接来的跟着源套算）"""
    import asr_listening as S

    todo = {(p, s) for p, s, _ in S.todo_list()}
    out = set(todo)
    for x in jload(PAPERS / "index.json"):
        p = jload(PAPERS / f"{x['id']}.json")
        src = S.shared_from(p)
        if src:
            out |= {(x["id"], s) for q, s in todo if q == src}
    return out


def paper_sentences(pid, skip_segs=()):
    """[(键, 英文)]，按卷面顺序、去重；卷面句子在前，听力原文在后。skip_segs：不收这些听力段 {(id, 段)}"""
    out, seen = [], set()

    def add(t):
        t = re.sub(r"\s+", " ", t or "").strip()
        if not wanted(t):
            return
        k = trans_key(t)
        if k in seen:
            return
        seen.add(k)
        out.append((k, t))

    wp = PAPERS / "pdf" / f"{pid}.words.json"
    if wp.exists():
        for page in jload(wp)["pages"]:
            for s in page.get("s", []):
                add(s)
    paper = jload(PAPERS / f"{pid}.json")
    for seg in (paper.get("audio") or {}).get("segments", []):
        if (pid, seg["id"]) in skip_segs or (pid, "all") in skip_segs:
            continue
        for ln in seg.get("lines", []):
            if ln.get("kind") in ("directions", "cue"):
                continue
            add(ln.get("text"))
    return out


def load_pool():
    return jload(POOL) if POOL.exists() else {}


def save_pool(pool):
    POOL.parent.mkdir(parents=True, exist_ok=True)
    POOL.write_text(json.dumps(pool, ensure_ascii=False, indent=0, sort_keys=True), "utf-8")


_HAN = r"[一-鿿“”‘’「」（）《》、。，；：？！…—]"
_PUNCT = {",": "，", ";": "；", ":": "：", "?": "？", "!": "！"}


def zh_punct(z):
    """中文句里的半角标点改全角（挨着汉字或中文标点的才改；1,000、3:30、A) 这类不动）"""
    z = re.sub(r"\s+", " ", z.strip())
    for a, b in _PUNCT.items():
        z = re.sub(rf"(?<={_HAN})\s*{re.escape(a)}\s*", b, z)
        z = re.sub(rf"\s*{re.escape(a)}\s*(?={_HAN})", b, z)
    return z


def check_zh(en, zh):
    """译文校验：返回问题描述，没问题返回 None"""
    if not isinstance(zh, str) or not zh.strip():
        return "空"
    z = zh.strip()
    n_cjk = len(CJK.findall(z))
    if n_cjk < 2:
        return "没有汉字"
    if z == en.strip():
        return "和英文一样"
    left = len(en_words(CJK.sub(" ", z)))
    if left > max(3, len(en_words(en)) * 0.5):
        return f"英文词太多（{left}）"
    if n_cjk < len(en) * 0.08 or n_cjk > len(en) * 1.2 + 10:
        return f"长度不对（{n_cjk} 字 / 英文 {len(en)} 字符）"
    return None


# ---------- 命令 ----------

def cmd_status(ids):
    pool = load_pool()
    tot_s = tot_t = 0
    uniq = set()
    for pid in ids:
        ss = paper_sentences(pid)
        have = sum(1 for k, _ in ss if k in pool)
        tot_s += len(ss)
        tot_t += have
        uniq.update(k for k, _ in ss)
        print(f"{pid:18s} 句 {len(ss):4d}  有译文 {have:4d}  缺 {len(ss) - have:4d}")
    miss = sum(1 for k in uniq if k not in pool)
    print(f"\n合计 {len(ids)} 套：句 {tot_s}（去重 {len(uniq)}），有译文 {tot_t}，去重后还缺 {miss}；总库 {len(pool)} 句")


HEADER_TMPL = """## 任务：把下面每行英文译成中文（大学英语四六级真题逐句译文，学生点一句英文看这句中文）。
## 每行是 "键<TAB>英文"；"# 试卷id" 行只提示上下文。句子按卷面/录音顺序，前后连着，可参考上下文。
## 1. 忠实、通顺、自然；不加解释、注释、括号说明；不漏译不增译；只写中文译文，不写英文原句。
## 2. 专有名词用通行译名，没有的可音译或保留英文。
## 3. 句首题号、选项字母原样保留："24. A) He believes..." → "24. A) 他认为……"；"Question 3. What ...?" → "第3题。……？"
## 4. 原文来自扫描识别，可能有噪声（粘连 todo、拆开 o f、多余数字字母、句子截断）：按原意译，不译噪声；截断的译到截断处。
## 5. 夹在句里的页眉页脚（"2025年12月四级真题（第一套） • 4"、"■"、页码）不译不留。
## 输出：用 Write 工具一次写出 {out}
##   内容是一个合法 JSON 对象 {{"键": "中文译文", ...}}，覆盖下面全部键（键原样）；双引号要转义。不要修改别的文件。
## 写完只回复一个词：done
"""


def with_header(path):
    """给待译文件加上任务说明（子代理只读这一个文件）"""
    path = Path(path)
    text = path.read_text("utf-8")
    if text.startswith("## "):
        return
    out = str(path.resolve().with_name(path.name.replace(".in.txt", ".out.json")))
    path.write_text(HEADER_TMPL.format(out=out) + text, "utf-8")


def cmd_todo(out_dir, ids, chunk, limit, skip_pending=False):
    pool = load_pool()
    skip = pending_asr_segments() if skip_pending else set()
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    have_in = set()
    for f in out_dir.glob("*.in.txt"):
        for line in f.read_text("utf-8").splitlines():
            if "\t" in line:
                have_in.add(line.split("\t", 1)[0])
    rows, seen = [], set(have_in)
    for pid in ids:
        for k, t in paper_sentences(pid, skip):
            if k in pool or k in seen:
                continue
            seen.add(k)
            rows.append((pid, k, t))
    if limit:
        rows = rows[:limit]
    start = len(list(out_dir.glob("*.in.txt")))
    n = 0
    for i in range(0, len(rows), chunk):
        part = rows[i:i + chunk]
        lines, cur = [], None
        for pid, k, t in part:
            if pid != cur:
                lines.append(f"# {pid}")
                cur = pid
            lines.append(f"{k}\t{t}")
        f = out_dir / f"{start + n:03d}.in.txt"
        f.write_text("\n".join(lines) + "\n", "utf-8")
        with_header(f)
        n += 1
    print(f"待译 {len(rows)} 句，写了 {n} 个文件（{out_dir}，从 {start:03d} 起，每个 ≤ {chunk} 句）；英文共 {sum(len(t) for _, _, t in rows)} 字符")


def read_inputs(d):
    src = {}
    for f in sorted(Path(d).glob("*.in.txt")):
        for line in f.read_text("utf-8").splitlines():
            if "\t" in line and not line.startswith("#"):
                k, t = line.split("\t", 1)
                src[k] = t
    return src


def cmd_check(d, name):
    """只校验一个批次 DIR/NAME.out.json（对照 NAME.in.txt），不写总库——几个子代理同时跑时各自自查用"""
    d = Path(d)
    src = {}
    for line in (d / f"{name}.in.txt").read_text("utf-8").splitlines():
        if "\t" in line and not line.startswith("#"):
            k, t = line.split("\t", 1)
            src[k] = t
    try:
        data = jload(d / f"{name}.out.json")
    except Exception as e:  # noqa: BLE001
        print(f"读不了 {name}.out.json：{e}")
        return
    bad = [(k, "不在待译清单里") for k in data if k not in src]
    bad += [(k, why) for k, zh in data.items() if k in src for why in [check_zh(src[k], zh)] if why]
    missing = [k for k in src if k not in data]
    for k, why in bad[:40]:
        print(f"  {k}：{why}｜{src.get(k, '')[:60]}｜{str(data.get(k))[:40]}")
    for k in missing[:40]:
        print(f"  缺 {k}｜{src[k][:60]}")
    print(f"{name}：输入 {len(src)} 句，译文 {len(data)} 句，不通过 {len(bad)}，缺 {len(missing)}")


def cmd_merge(d):
    src = read_inputs(d)
    pool = load_pool()
    ok = bad = unknown = 0
    problems = []
    for f in sorted(Path(d).glob("*.out.json")):
        try:
            data = jload(f)
        except Exception as e:  # noqa: BLE001
            problems.append(f"{f.name}：读不了（{e}）")
            continue
        for k, zh in data.items():
            if k not in src:
                unknown += 1
                problems.append(f"{f.name} {k}：不在待译清单里")
                continue
            why = check_zh(src[k], zh)
            if why:
                bad += 1
                problems.append(f"{f.name} {k}：{why}｜{src[k][:60]}｜{str(zh)[:40]}")
                continue
            z = zh_punct(zh)
            if pool.get(k, {}).get("zh") != z:
                pool[k] = {"en": src[k], "zh": z}
            ok += 1
    save_pool(pool)
    missing = [k for k in src if k not in pool]
    for p in problems[:60]:
        print("  " + p)
    if len(problems) > 60:
        print(f"  ……另有 {len(problems) - 60} 条")
    print(f"\n合并：通过 {ok}，不通过 {bad}，键对不上 {unknown}；待译清单 {len(src)} 句里还缺 {len(missing)} 句；总库 {len(pool)} 句")
    return missing


def cmd_write(ids):
    pool = load_pool()
    TRANS.mkdir(parents=True, exist_ok=True)
    files = sents = 0
    for pid in ids:
        ss = paper_sentences(pid)
        got = {k: zh_punct(pool[k]["zh"]) for k, _ in ss if k in pool}
        path = TRANS / f"{pid}.json"
        if not got:
            continue
        data = {"id": pid, "by": "ai", "version": VERSION, "sentences": got}
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"
        if not path.exists() or path.read_text("utf-8") != text:
            path.write_text(text, "utf-8")
        files += 1
        sents += len(got)
    print(f"写出 {files} 个译文文件（{TRANS.relative_to(ROOT).as_posix()}/），共 {sents} 句")


def cmd_sample(n, ids, seed=None):
    pool = load_pool()
    rows = [(pid, k, t) for pid in ids for k, t in paper_sentences(pid) if k in pool]
    rnd = random.Random(seed)
    for pid, k, t in rnd.sample(rows, min(n, len(rows))):
        print(f"[{pid} {k}] {t}\n    {pool[k]['zh']}")


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("status"); s.add_argument("ids", nargs="*")
    s = sub.add_parser("todo"); s.add_argument("dir"); s.add_argument("ids", nargs="*"); s.add_argument("--chunk", type=int, default=300); s.add_argument("--limit", type=int, default=0); s.add_argument("--skip-pending-asr", action="store_true")
    s = sub.add_parser("merge"); s.add_argument("dir")
    s = sub.add_parser("check"); s.add_argument("dir"); s.add_argument("name")
    s = sub.add_parser("write"); s.add_argument("ids", nargs="*")
    s = sub.add_parser("sample"); s.add_argument("n", type=int); s.add_argument("ids", nargs="*"); s.add_argument("--seed", type=int)
    a = ap.parse_args()
    ids = getattr(a, "ids", None) or catalog_ids()
    if a.cmd == "status":
        cmd_status(ids)
    elif a.cmd == "todo":
        cmd_todo(a.dir, ids, a.chunk, a.limit, a.skip_pending_asr)
    elif a.cmd == "merge":
        cmd_merge(a.dir)
    elif a.cmd == "check":
        cmd_check(a.dir, a.name)
    elif a.cmd == "write":
        cmd_write(ids)
    else:
        cmd_sample(a.n, ids, a.seed)


if __name__ == "__main__":
    main()
