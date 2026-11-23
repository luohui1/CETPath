"""词根词缀层 public/dict/roots/<a-z|_>.json：{小写词: {"m": [[语素, 中文含义, 来源注]], "e": 词源说明, "s": [[同根词, 简义]], "b": 派生词的原词}}。

来源：OpenEtymology 开源单词本（CET4/CET6/TEM8/TOEFL/GRE8000 的 EPUB，词条 CC BY-SA 4.0，
https://github.com/openetymology/OpenEtymology）。把 5 个 EPUB 放到 data/raw/openetymology/ 再运行：

  python -I scripts/build_roots.py

单词本里没有、但能拆成"常见前缀/后缀 + 单词本里有的词"的派生词（unreliable、formerly），补一条 b=原词 的拆法，
原词的含义用本站词典（public/dict/shards）的第一个义项。同根词只列四六级/考研词书里的词，按词频排，最多 4 个。
"""
import html
import json
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "openetymology"
DICT = ROOT / "public" / "dict"
OUT = DICT / "roots"

TAG = re.compile(r"<[^>]+>")
ENTRY = re.compile(r'<section class="word-entry" id="[^"]*">(.*?)</section>\s*(?=<section class="word-entry"|</section>\s*</body>|</section>\s*$)', re.S)
ETY = re.compile(r"<h3>Etymology</h3>\s*<p>(.*?)</p>", re.S)
MORPH = re.compile(r'<ul class="morphemes">(.*?)</ul>', re.S)
LI = re.compile(r"<li><strong>(.*?)</strong>(.*?)</li>", re.S)
NOTE = re.compile(r'<span class="note">(.*?)</span>', re.S)

# 不算词根的语素：同根词不按这些找
NOT_ROOT = re.compile(r"后缀|前缀|加强|无实义|连接|不可拆分|复数|过去|比较级|最高级")
PREFIXES = {
    "un": "不", "in": "不", "im": "不", "il": "不", "ir": "不", "dis": "不；相反", "non": "非", "mis": "错误",
    "re": "再；回", "over": "过度", "under": "不足；在下", "anti": "反对", "inter": "相互；之间", "pre": "预先",
    "post": "之后", "sub": "在下", "super": "超", "co": "共同", "counter": "反", "self": "自己", "out": "超过；向外",
}
SUFFIXES = [  # (后缀, 含义, 还原原词的办法)
    ("ally", "副词后缀", ["al", ""]), ("ly", "副词后缀", ["", "le", "e"]), ("ness", "名词后缀", ["", "y"]),
    ("ment", "名词后缀", ["", "e"]), ("ation", "名词后缀", ["e", "", "ate"]), ("ion", "名词后缀", ["", "e"]),
    ("er", "表示人或物", ["", "e"]), ("or", "表示人或物", ["", "e"]), ("ist", "表示人", ["", "e", "y"]),
    ("ity", "名词后缀", ["", "e"]), ("able", "能…的", ["", "e"]), ("ible", "能…的", ["", "e"]),
    ("ful", "充满…的", ["", "y"]), ("less", "没有…的", ["", "y"]), ("al", "形容词后缀", ["", "e"]),
    ("ical", "形容词后缀", ["ic", "y"]), ("ic", "形容词后缀", ["", "y"]), ("ive", "形容词后缀", ["", "e"]),
    ("ize", "使…化", ["", "e"]), ("ise", "使…化", ["", "e"]), ("ship", "名词后缀", [""]), ("hood", "名词后缀", [""]),
    ("ous", "形容词后缀", ["", "e", "y"]), ("y", "形容词后缀", ["", "e"]), ("en", "使…", ["", "e"]),
    ("ing", "名词后缀", ["", "e"]), ("ism", "名词后缀", ["", "e"]), ("ance", "名词后缀", ["", "e"]),
    ("ence", "名词后缀", ["", "e"]), ("ant", "形容词后缀", ["", "e"]), ("ent", "形容词后缀", ["", "e"]),
]


def text(s):
    return re.sub(r"\s+", " ", html.unescape(TAG.sub("", s))).strip()


def parse():
    out = {}
    for ep in sorted(RAW.glob("*.epub")):
        z = zipfile.ZipFile(ep)
        for name in sorted(z.namelist()):
            if not name.endswith(".xhtml"):
                continue
            s = z.read(name).decode()
            for b in s.split('<section class="word-entry"')[1:]:
                h = re.search(r"<h2>(.*?)</h2>", b)
                if not h:
                    continue
                w = text(h.group(1))
                key = w.lower()
                if key in out:
                    continue
                mm = MORPH.search(b)
                morph = []
                for part, rest in LI.findall(mm.group(1)) if mm else []:
                    note = NOTE.search(rest)
                    mean = text(NOTE.sub("", rest))
                    m = [text(part), mean]
                    if note:
                        m.append(text(note.group(1)))
                    morph.append(m)
                ety = ETY.search(b)
                e = text(ety.group(1)) if ety else ""
                if morph or e:
                    out[key] = {"m": morph, "e": e}
    return out


def load_dict():
    d = {}
    for f in (DICT / "shards").glob("*.json"):
        d.update(json.loads(f.read_text("utf8")))
    return d


def brief(entry):
    first = (entry.get("t") or "").split("\n")[0]
    first = re.sub(r"^[a-z]+\.\s*", "", first)
    return "，".join([x for x in re.split(r"[,，;；]\s*", first) if x][:2])


def derive(word, oe, dic):
    """派生词拆成 前缀+原词 或 原词+后缀；原词要在单词本里"""
    for p, mean in PREFIXES.items():
        base = word[len(p):]
        if word.startswith(p) and len(base) >= 4 and base in oe and base in dic:
            return [[p, mean], [base, brief(dic[base])]], base
    for suf, mean, fixes in SUFFIXES:
        if not word.endswith(suf) or len(word) - len(suf) < 3:
            continue
        stem = word[: -len(suf)]
        cands = [stem + f for f in fixes]
        if len(stem) > 3 and stem[-1] == stem[-2]:
            cands.append(stem[:-1])  # 双写：beginner → begin
        if stem.endswith("i"):
            cands.append(stem[:-1] + "y")  # happiness → happy
        for base in cands:
            if base != word and base in oe and base in dic:
                return [[base, brief(dic[base])], [suf, mean]], base
    return None


def main():
    if not RAW.exists():
        sys.exit(f"缺少 {RAW}（放 OpenEtymology 的 EPUB）")
    oe = parse()
    dic = load_dict()
    books = {}
    for b in ("cet4", "cet6", "ky"):
        for e in json.loads((DICT / "books" / f"{b}.json").read_text("utf8")):
            books[e["w"].lower()] = e.get("f") or 99999

    entries = {w: v for w, v in oe.items() if w in dic}
    derived = 0
    for w in books:
        if w not in entries and w in dic:
            r = derive(w, oe, dic)
            if r:
                entries[w] = {"m": r[0], "e": "", "b": r[1]}
                derived += 1

    # 同根词：语素写法 + 含义第一个词相同
    # 单词本里常在词头、词尾出现的语素（con、trans、-ure）当前缀/后缀，不按它找同根词
    head, tail = defaultdict(int), defaultdict(int)
    for v in oe.values():
        if len(v["m"]) > 1:
            head[v["m"][0][0].lower()] += 1
            tail[v["m"][-1][0].lower()] += 1

    def root_keys(m):
        keys = []
        for i, x in enumerate(m):
            part, mean = x[0].lower(), x[1]
            if len(m) < 2 or len(part) < 3 or NOT_ROOT.search(mean):
                continue
            if (i == 0 and (part in PREFIXES or head[part] >= 10)) or (i == len(m) - 1 and tail[part] >= 10):
                continue
            keys.append(part + "|" + re.split(r"[；;，,/ ]", mean)[0])
        return keys

    by_root = defaultdict(list)
    for w, v in entries.items():
        if w in books and "b" not in v:
            for k in root_keys(v["m"]):
                by_root[k].append(w)
    for w, v in entries.items():
        if "b" in v:
            continue
        sib = []
        for k in root_keys(v["m"]):
            for x in sorted(by_root.get(k, []), key=lambda x: books[x]):
                if x != w and x not in sib and not x.startswith(w) and not w.startswith(x):
                    sib.append(x)
        if sib:
            v["s"] = [[x, brief(dic[x])] for x in sib[:4]]

    OUT.mkdir(parents=True, exist_ok=True)
    shards = defaultdict(dict)
    for w, v in entries.items():
        if not v["e"]:
            del v["e"]
        shards[w[0] if "a" <= w[0] <= "z" else "_"][w] = v
    for f in OUT.glob("*.json"):
        f.unlink()
    for s, d in shards.items():
        (OUT / f"{s}.json").write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), "utf8")
    cov = sum(1 for w in books if w in entries)
    print(f"OpenEtymology {len(oe)} 条，收进 {len(entries)} 条（派生补 {derived}）；词书 {len(books)} 词覆盖 {cov}（{cov / len(books):.0%}）")


if __name__ == "__main__":
    main()
