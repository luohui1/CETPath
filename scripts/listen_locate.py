"""听力题的答案位置：解析层 public/papers/explain/<id>.json → questions[qid].fields.locate.line = {segment, index}
（index 是该段 audio.segments[].lines 里的下标）。界面在原文和时间轴上按这个字段标答案句（设计见
docs/设计任务-I轮-听力与译文与小窗.md §0.3、§2）。

只增不删：已经有 line 的题不动；匹配不上的不写（不会像 align_transcripts.py --relink-explain 那样删掉旧的 line）。

  python -I scripts/listen_locate.py stats [id ...]      覆盖率：有行号 / 只有引文 / 没定位 / 段里没原文
  python -I scripts/listen_locate.py quote [id ...]      只有引文（locate.quote）没行号的：在本段原文里模糊匹配，
                                                          词重合度最高且 ≥ 0.6 的那一句或连续两句，写 line（连续两句取命中多的那句）
  python -I scripts/listen_locate.py sync [id ...]       第 3 套接的是同场另一套的听力（试卷 JSON 的 shared）：
                                                          把那一套的 audio、题组的 audioSegment、听力题的解析条目同步过来
                                                          （本套没有 fields 的整条照抄；都有 fields 且引文相同的，行号以那套为准）

没定位的题（多半是整条都没有结构化解析）走 structure_explanations.py 的 prep → 写批次 → merge，
merge 校验 quote 原样在这一段原文里；写进去以后再跑一次本脚本的 quote 补 line。
"""
import argparse
import copy
import io
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAPERS = ROOT / "public" / "papers"
EXPLAIN = PAPERS / "explain"
MIN_COVER = 0.6


def jload(p):
    return json.loads(Path(p).read_text("utf-8"))


def save_paper(pid, paper):
    (PAPERS / f"{pid}.json").write_text(json.dumps(paper, ensure_ascii=False, indent=2) + "\n", "utf-8")


def save_layer(path, layer, raw=None):
    """解析层：indent=1，换行沿用原文件"""
    raw = raw if raw is not None else (path.read_bytes() if path.exists() else b"")
    nl = "\r\n" if b"\r\n" in raw else "\n"
    tmp = path.with_suffix(".json.tmp")
    with io.open(tmp, "w", encoding="utf-8", newline=nl) as f:
        json.dump(layer, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def catalog_ids():
    return [x["id"] for x in jload(PAPERS / "index.json") if x["id"].startswith("cet")]


def is_content(line):
    return not line.get("kind") and bool((line.get("text") or "").strip())


def listening_items(paper):
    """[(group, question, segment dict or None)]"""
    segs = {s["id"]: s for s in (paper.get("audio") or {}).get("segments", [])}
    out = []
    for s in paper["sections"]:
        if s["kind"] != "listening":
            continue
        for g in s["groups"]:
            seg = segs.get(g.get("audioSegment"))
            for q in g["questions"]:
                out.append((g, q, seg))
    return out


# ---------- 模糊匹配 ----------

def mwords(text):
    """比较用的词：小写、去撇号，只比前 7 个字母（识别错字多在词尾）"""
    t = (text or "").replace("’", "'").replace("‘", "'").lower().replace("'", "")
    return [w[:7] for w in re.findall(r"[a-z0-9]+", t)]


def cover(q, w):
    cq, cw = Counter(q), Counter(w)
    hit = sum(min(n, cw[k]) for k, n in cq.items())
    return hit / max(1, len(q))


def bigram_cover(q, w):
    if len(q) < 2:
        return cover(q, w)
    return cover(list(zip(q, q[1:])), list(zip(w, w[1:])))


def match_quote(quote, lines):
    """quote 在这一段原文里最像哪一句（或连续两句）：返回 (index, 词重合度)，不够 0.6 返回 (None, 分)"""
    q = mwords(quote)
    if len(q) < 2:
        return None, 0.0
    cand = [i for i, l in enumerate(lines) if is_content(l)]
    words = {i: mwords(lines[i]["text"]) for i in cand}
    best, best_key = None, (0.0, 0.0, 0)
    for k, i in enumerate(cand):
        options = [([i], words[i])]
        if k + 1 < len(cand) and cand[k + 1] == i + 1:
            options.append(([i, i + 1], words[i] + words[i + 1]))
        for idxs, w in options:
            c = cover(q, w)
            key = (round(c, 4), round(bigram_cover(q, w), 4), -len(idxs))  # 重合度 → 词序 → 单句优先
            if key > best_key:
                # 连续两句：取命中多的那句
                pick = max(idxs, key=lambda j: (cover(q, words[j]), -j)) if len(idxs) > 1 else idxs[0]
                best, best_key = pick, key
    return (best, best_key[0]) if best_key[0] >= MIN_COVER else (None, best_key[0])


# ---------- 命令 ----------

def stats(ids, quiet=False):
    tot = Counter()
    for pid in ids:
        paper = jload(PAPERS / f"{pid}.json")
        ep = EXPLAIN / f"{pid}.json"
        layer = jload(ep)["questions"] if ep.exists() else {}
        for g, q, seg in listening_items(paper):
            tot["total"] += 1
            if not seg or not any(is_content(l) for l in seg["lines"]):
                tot["noscript"] += 1
                continue
            loc = ((layer.get(q["id"]) or {}).get("fields") or {}).get("locate") or {}
            tot["line" if loc.get("line") else "quote" if loc.get("quote") else "none"] += 1
    if not quiet:
        print(f"听力题 {tot['total']}：有行号 {tot['line']}，只有引文 {tot['quote']}，没定位 {tot['none']}，段里没原文 {tot['noscript']}")
    return tot


def link_quotes(ids, log=print):
    tot = Counter()
    for pid in ids:
        paper = jload(PAPERS / f"{pid}.json")
        ep = EXPLAIN / f"{pid}.json"
        if not ep.exists():
            continue
        raw = ep.read_bytes()
        layer = json.loads(raw.decode("utf-8"))
        n = miss = 0
        for g, q, seg in listening_items(paper):
            ent = layer["questions"].get(q["id"]) or {}
            loc = (ent.get("fields") or {}).get("locate")
            if not seg or not isinstance(loc, dict) or loc.get("line") or not loc.get("quote"):
                continue
            idx, sc = match_quote(loc["quote"], seg["lines"])
            if idx is None:
                miss += 1
                log(f"  {pid} {q['id']} 没匹配上（{sc:.2f}）：{loc['quote'][:80]}")
                continue
            loc["line"] = {"segment": seg["id"], "index": idx}
            n += 1
        if n:
            save_layer(ep, layer, raw)
        if n or miss:
            log(f"{pid}  写 line {n}，没匹配上 {miss}")
        tot["linked"] += n
        tot["miss"] += miss
    log(f"\n引文匹配：写 line {tot['linked']} 条，没匹配上 {tot['miss']} 条")
    return tot


def sync_shared(ids, log=print):
    """第 3 套接的听力和被借那套保持一致：audio、题组 audioSegment、听力题解析条目"""
    tot = Counter()
    for pid in ids:
        paper = jload(PAPERS / f"{pid}.json")
        sh = next((x for x in paper.get("shared") or [] if x["section"] == "listening"), None)
        if not sh:
            continue
        src = jload(PAPERS / f"{sh['from']}.json")
        changed = False
        if paper.get("audio") != src.get("audio"):
            paper["audio"] = copy.deepcopy(src["audio"])
            changed = True
            tot["audio"] += 1
        sgroups = {g["id"]: g for s in src["sections"] if s["kind"] == "listening" for g in s["groups"]}
        for s in paper["sections"]:
            if s["kind"] != "listening":
                continue
            for g in s["groups"]:
                want = (sgroups.get(g["id"]) or {}).get("audioSegment")
                if want and g.get("audioSegment") != want:
                    g["audioSegment"] = want
                    changed = True
                    tot["groups"] += 1
        if changed:
            save_paper(pid, paper)
        # 解析层
        sp, tp = EXPLAIN / f"{sh['from']}.json", EXPLAIN / f"{pid}.json"
        if not sp.exists():
            continue
        sl = jload(sp)["questions"]
        raw = tp.read_bytes() if tp.exists() else b""
        layer = json.loads(raw.decode("utf-8")) if raw else {"id": pid, "questions": {}, "groups": {}}
        n_copy = n_line = 0
        for g, q, seg in listening_items(paper):
            se = sl.get(q["id"])
            if not se:
                continue
            te = layer["questions"].get(q["id"])
            if not (te or {}).get("fields"):
                if se.get("fields") and te != se:
                    layer["questions"][q["id"]] = copy.deepcopy(se)
                    n_copy += 1
                continue
            sloc = (se.get("fields") or {}).get("locate") or {}
            tloc = te["fields"].get("locate")
            rest = lambda f: {k: v for k, v in (f or {}).items() if k != "locate"}  # noqa: E731
            if sloc and tloc != sloc and rest(te["fields"]) == rest(se.get("fields")):
                # 同一条解析（照抄来的），被借那套改过引文或行号：整个 locate 跟过来
                te["fields"]["locate"] = copy.deepcopy(sloc)
                n_line += 1
                continue
            # 引文相同：行号以被借那套为准（那套重写过原文，行号会变）
            if isinstance(tloc, dict) and tloc.get("quote") == sloc.get("quote") and tloc.get("line") != sloc.get("line"):
                if sloc.get("line"):
                    tloc["line"] = copy.deepcopy(sloc["line"])
                else:
                    tloc.pop("line", None)
                n_line += 1
        if n_copy or n_line:
            save_layer(tp, layer, raw)
        if changed or n_copy or n_line:
            log(f"{pid} ← {sh['from']}：audio {'同步' if changed else '不变'}，解析条目照抄 {n_copy}，补 line {n_line}")
        tot["copied"] += n_copy
        tot["lines"] += n_line
    log(f"\n第 3 套同步：audio {tot['audio']} 套，题组 audioSegment {tot['groups']} 个，解析条目 {tot['copied']} 条，补 line {tot['lines']} 条")
    return tot


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["stats", "quote", "sync"])
    ap.add_argument("ids", nargs="*")
    a = ap.parse_args()
    ids = a.ids or catalog_ids()
    if a.cmd == "stats":
        stats(ids)
    elif a.cmd == "quote":
        link_quotes(ids)
        stats(ids)
    else:
        sync_shared(ids)
        stats(ids)


if __name__ == "__main__":
    main()
