"""易混词层 public/dict/confusables.json：{"w": {词: [[易混词, 简义, 组号]]}, "g": [[提示, 错句, 改正, 说明]]}。

两种来源：
1. Lexkite 的易混词数据集（82 组，affect/effect、adapt/adopt，CC BY 4.0，
   https://github.com/lexkiteapp/confused-words-dataset），放到 data/raw/lexkite/confused-words.json。组号指向 "g" 里的提示。
2. 形近词：四六级/考研词书里拼写只差一两个字母、又不是同根或词形变化的词（adapt/adept、principal/principle），组号是 -1。

  python -I scripts/build_confusables.py
"""
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DICT = ROOT / "public" / "dict"
LEX = ROOT / "data" / "raw" / "lexkite" / "confused-words.json"
OUT = DICT / "confusables.json"
MAX = 3

SUFFIX = re.compile(r"^(s|es|ed|d|ing|ly|ily|er|ers|or|al|ally|ion|ation|ness|ment|y|ity|ive|ic|ics|ical|ist|ism|ary|ery|ory|ful|less|able|ible|ance|ence|ant|ent|ate|ise|ize|ous|e|en|ure|age|ship|ward|wards|ee)?$")


def load_dict():
    d = {}
    for f in (DICT / "shards").glob("*.json"):
        d.update(json.loads(f.read_text("utf8")))
    return d


def brief(entry):
    first = (entry.get("t") or "").split("\n")[0]
    first = re.sub(r"^[a-z]+\.\s*", "", first)
    return "，".join([x for x in re.split(r"[,，;；]\s*", first) if x][:2])


def lev(a, b, cap):
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        if min(cur) > cap:
            return cap + 1
        prev = cur
    return prev[-1]


def deletes(w, n):
    out = {w}
    for _ in range(n):
        out |= {x[:i] + x[i + 1 :] for x in out for i in range(len(x))}
    return out


NEG = ("un", "in", "im", "il", "ir", "dis", "non", "mis", "re", "a")


def related(a, b, fams):
    """同根、派生或词形变化：不算易混"""
    if fams.get(a, set()) & fams.get(b, set()):
        return True
    if any(a == n + b or b == n + a for n in NEG):
        return True
    # 英美拼写（neighbour/neighbor、centre/center）、国名和形容词（india/indian）
    us = lambda w: w.replace("our", "or").replace("tre", "ter").replace("ise", "ize")
    if us(a) == us(b) or a + "n" == b or b + "n" == a:
        return True
    p = len(os.path.commonprefix([a, b]))
    for k in (p, p - 1, p - 2):
        if k >= 3 and SUFFIX.match(a[k:]) and SUFFIX.match(b[k:]):
            return True
    return False


def main():
    dic = load_dict()
    books = {}
    for b in ("cet4", "cet6", "ky"):
        for e in json.loads((DICT / "books" / f"{b}.json").read_text("utf8")):
            w = e["w"].lower()
            books[w] = min(books.get(w, 1e9), e.get("f") or 99999)
    fams = defaultdict(set)
    fam_file = DICT / "roots" / "families.json"
    if fam_file.exists():
        for f in json.loads(fam_file.read_text("utf8")):
            for x in f["w"]:
                fams[x[0]].add(f["r"])

    out = defaultdict(list)
    groups = []
    if LEX.exists():
        for g in json.loads(LEX.read_text("utf8"))["groups"]:
            ws = [x["w"].lower() for x in g["words"]]
            m = (g.get("mistakes") or [{}])[0]
            gi = len(groups)
            groups.append([g.get("tip", ""), m.get("wrong", ""), m.get("right", ""), m.get("note", "")])
            for w in ws:
                for o in ws:
                    if o != w:
                        out[w].append([o, brief(dic[o]) if o in dic else "", gi])
    else:
        print(f"没有 {LEX}，只生成形近词", file=sys.stderr)

    words = [w for w in books if w.isalpha() and len(w) >= 5 and w in dic]
    index = defaultdict(set)
    cap = lambda w: 1 if len(w) < 8 else 2
    for w in words:
        for k in deletes(w, cap(w)):
            index[k].add(w)
    pairs = set()
    for w in words:
        for k in deletes(w, cap(w)):
            for o in index[k]:
                if o <= w or (w, o) in pairs:
                    continue
                c = min(cap(w), cap(o))
                # 头两个字母一样才算形近（brave/grave 一眼就分得清）
                if w[:2] == o[:2] and lev(w, o, c) <= c and not related(w, o, fams):
                    pairs.add((w, o))
    sim = defaultdict(list)
    for a, b in pairs:
        d = lev(a, b, 2)
        sim[a].append((d, books[b], b))
        sim[b].append((d, books[a], a))
    for w, cands in sim.items():
        have = {x[0] for x in out[w]}
        for _, _, o in sorted(cands):
            if len(out[w]) >= MAX:
                break
            if o not in have:
                out[w].append([o, brief(dic[o]), -1])
    OUT.write_text(json.dumps({"w": out, "g": groups}, ensure_ascii=False, separators=(",", ":")), "utf8")
    print(f"Lexkite {len(groups)} 组，形近词对 {len(pairs)}，有易混词的词 {len(out)}，{OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
