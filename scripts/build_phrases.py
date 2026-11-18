"""短语表（2026-11-12）：点词时认出这个词所在的短语（come up with、in terms of、make up one's mind…），卡片上给短语的意思。

用户："很多短语我没法查，只能查句子翻译和单词翻译"。站上的词典（public/dict/shards）只有单词；ECDICT 原表（data/raw/ecdict/ecdict.csv）
有 36 万个多词条目，大半是医、化、计算机的术语。这里只留**在本站试卷里真出现过**的（按词形还原比对：came up with 算 come up with，
one's 对得上 his/their…，sb/sth 对得上任意一个词），意思去掉 [医][化][网络] 这类领域行，没有通用意思的不要。

输出 public/dict/phrases.json：{"v":1,"p":[[词形还原后的词（占位符 ~poss ~refl ~any）, 原写法, 意思, 本站出现次数, 能不能隔开（1：动词 + 小品词）], …]}
前端 src/lib/phrases.ts 建成前缀树，点词时在这句里往前后找最长的短语。

  python -I scripts/build_phrases.py           生成
  python -I scripts/build_phrases.py --top 80   生成后列出出现最多的 80 个，人工看一眼有没有垃圾（黑名单在 BLOCK）
"""
import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ECDICT = ROOT / "data" / "raw" / "ecdict" / "ecdict.csv"
OUT = ROOT / "public" / "dict" / "phrases.json"
sys.stdout.reconfigure(encoding="utf-8")
csv.field_size_limit(10**8)

POSS = {"my", "your", "his", "her", "its", "our", "their", "one's", "ones"}
REFL = {"myself", "yourself", "himself", "herself", "itself", "ourselves", "yourselves", "themselves", "oneself"}
ANY = {"sb", "sth", "sw"}  # 只认缩写当占位；something / somebody 写全了多半是字面意思（or something "或是什么的"）
# 句中的 sb/sth 只对得上代词（remind him of；"have people in" 不能当成 have sb in "把某人叫进来"）
OBJ = {"me", "you", "him", "her", "it", "us", "them", "this", "that", "these", "those", "someone", "somebody", "something", "anyone", "anything", "everyone", "everything"}
# 很常用的词：两个都是这种词的短语（he is、to do、in one、all the…）多半是词典里的凑数条目，除非在 KEEP 里
COMMON = set("""a an the and or but if so as of to in on at for with by from up out about into over after before than then that this these those
it its he she i you we they me him her us them my your his our their is are was were be been being am do does did done have has had having will would
can could shall should may might must not no yes there here what which who whom whose when where why how all any some each every both either neither one two
more most much many such very just also only even still too again ever never now well get got go going went come came make made take took give gave say said
see saw know knew think thought like want need use used good way time world thing things people""".split())
KEEP = {"have to", "has to", "had to", "used to", "going to", "as well", "as well as", "so that", "such as", "more than", "no more", "at least", "not only",
        "even if", "as if", "how about", "what about", "up to", "out of", "all over", "at all", "each other", "one another", "as to", "in that", "now that",
        "more and more", "so as to", "as much as", "as many as", "no more than", "not only but also", "all in all", "after all", "at most", "and so on",
        "as long as", "as far as", "so much", "too much", "come up", "come out", "come back", "go on", "go out", "go back", "get up", "get out", "make up",
        "take up", "give up", "look up", "set up", "turn out", "find out", "work out", "take over", "get over", "think over", "come about", "bring up"}
TOKEN = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)*")
# 词典里有、试卷里也常出现，但当"短语"给出来是噪声的（人工看 --top 定的）
# 动词短语里可以和动词隔开的小品词；隔着的词里出现这些就不算（多半已经是另一个分句）。和 src/lib/phrases.ts 一致
PARTICLES = {"up", "down", "out", "off", "in", "on", "over", "back", "away", "around", "round", "through", "apart", "aside", "together", "forward", "along", "across", "about", "by"}
BREAK = {"and", "but", "or", "that", "which", "who", "whom", "whose", "because", "if", "when", "while", "than", "so", "where",
         # 情态动词、介词：隔着的是分句或介词短语，不是宾语（voice could soon take over、talk with them about）
         "can", "could", "will", "would", "shall", "should", "may", "might", "must",
         "from", "with", "to", "for", "of", "at", "into", "onto", "as", "like", "without", "within",
         # 助动词：隔着的是另一个谓语（studies programmes have sprung up 不是 study … up）
         "have", "has", "had", "is", "are", "was", "were", "be", "been", "being", "do", "does", "did"}
MAX_GAP = 4
# 真能和动词拆开的小品词（cut its queues down、heat things up）。in/on/by/about 多半是介词：took part in 不是 take … in
SEPARABLE = {"up", "down", "out", "off", "back", "away", "over", "around", "round", "through", "apart", "aside", "together", "forward"}
# 隔着的词像分词（involved、loading、generated）就不是宾语
PARTICIPLE = re.compile(r"^[a-z]{3,}(ing|ed)$|^[a-z]{3,}ly$")  # 还有 -ly 副词（falling dramatically over）
OBJ_WORDS = {"something", "nothing", "anything", "everything"}
# 短语动词常见的打头动词（词形还原后）
PHRASAL = {"have", "get", "go", "come", "make", "take", "give", "see", "know", "think", "use", "do", "say", "look", "put", "set", "turn", "bring", "keep", "find", "work"}
BLOCK = {
    "the most", "the same", "the first", "the other", "one of", "some of", "all of", "most of", "part of", "there be", "be to", "be in",
    "how to", "to it", "a single", "a good", "all the", "the more", "and that", "in one", "live in", "like to", "want to", "looking at",
    "base on", "follow by", "came to", "years ago", "on the news", "line through", "numbers of", "and others",
    "work in", "don't know", "of choice", "groups of", "the last", "stay in",
    # 动词打头、全是常用词、词典给的意思在试卷里多半对不上的（词形还原后的写法）
    "have be", "go to", "have not", "do in", "do it", "use in", "do for", "make it", "use for", "use by", "have do", "take it", "have best",
    "come in", "come into", "do you know", "do by", "have it", "make in", "go and", "give me", "do good", "come with", "see that", "make of",
    "have on", "come to", "take time", "get it", "have get", "do well", "take to", "go for",
}
# 意思是人名、歌名、片名的
NAMEY = re.compile(r"人名|歌曲|电影|专辑|乐队|小说名|书名|游戏名|地名")


def norm_token(t: str, lemma: dict) -> str:
    t = t.lower().replace("’", "'").strip(".")
    if t in ("one's", "sb's", "ones"):
        return "~poss"
    if t == "oneself":
        return "~refl"
    if t in ANY:
        return "~any"
    return lemma.get(t, t)


def clean_trans(raw: str) -> str:
    lines = [x.strip() for x in raw.replace("\\n", "\n").split("\n")]
    keep = [x for x in lines if x and not x.startswith("[")]
    # 去掉开头的词性、口语标记：v. n. adj. na. un. <口>
    keep = [re.sub(r"^(?:(?:[a-z]{1,5}\.|<[^>]{1,4}>)\s*)+", "", x) for x in keep]
    text = "；".join(x for x in keep if x)
    text = re.sub(r"\s*,\s*", "，", text)
    text = re.sub(r"\s*;\s*", "；", text)
    text = re.sub(r"\.\.\.|…", "…", text)
    return text.strip(" ；，")[:80]


VERBS: set = set()


def load_verbs():
    with ECDICT.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            w = row["word"].strip().lower()
            if " " not in w and re.search(r"(^|\\n|\s)v[ti]?\.", row["translation"]):
                VERBS.add(w)


def gappable(toks) -> int:
    return int(len(toks) >= 2 and toks[0] in VERBS and toks[1] in SEPARABLE)


def load_phrases(lemma: dict):
    out = []
    with ECDICT.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            w = row["word"].strip()
            if " " not in w or not re.fullmatch(r"[A-Za-z][A-Za-z' .’-]*", w):
                continue
            words = w.replace("’", "'").split()
            if not 2 <= len(words) <= 6:
                continue
            if w.lower() in BLOCK:
                continue
            trans = clean_trans(row["translation"])
            if not trans or not re.search(r"[一-鿿]", trans) or NAMEY.search(trans):
                continue
            toks = [norm_token(x, lemma) for x in words]
            # 末尾的占位（lead to sth、think of sb）去掉：留着会把 "lead to" 后面随便一个词都算进来
            while toks and toks[-1] in ("~any", "~poss"):
                toks.pop()
            if len(toks) < 2 or toks[0].startswith("~"):
                continue
            plain = " ".join(t for t in toks if not t.startswith("~"))
            if plain in BLOCK or " ".join(toks) in BLOCK:
                continue
            # 全是常用词的：动词打头的短语动词（come up with、give up、go on）留下，其余（he is、in one、all the）不要
            if all(t in COMMON or t.startswith("~") for t in toks) and plain not in KEEP and toks[0] not in PHRASAL:
                continue
            out.append((toks, w.rstrip(". "), trans))
    # 同一串词（at the end of / at the end of...；grew up / grow up）只留一个：原形写法的优先（grow up），其次先来的
    def is_base(x):
        return all(t.startswith("~") or t == w.lower().strip(".") for t, w in zip(x[0], x[1].replace("’", "'").split()))

    best: dict = {}
    for x in out:
        k = " ".join(x[0])
        if k not in best or (is_base(x) and not is_base(best[k])):
            best[k] = x
    return list(best.values())


def corpus_sentences():
    """全站试卷的句子：卷面单词层（按句分好的）+ 听力原文每一行"""
    idx = json.loads((ROOT / "public" / "papers" / "index.json").read_text("utf-8"))
    for x in idx:
        pid = x["id"]
        wp = ROOT / "public" / "papers" / "pdf" / f"{pid}.words.json"
        if wp.exists():
            for page in json.loads(wp.read_text("utf-8"))["pages"]:
                cur, toks = None, []
                for w in page["w"]:
                    if w[5] != cur and toks:
                        yield toks
                        toks = []
                    cur = w[5]
                    toks.extend(TOKEN.findall(w[0]))
                if toks:
                    yield toks
        pp = ROOT / "public" / "papers" / f"{pid}.json"
        if pp.exists():
            paper = json.loads(pp.read_text("utf-8"))
            for seg in (paper.get("audio") or {}).get("segments", []):
                for line in seg.get("lines", []):
                    yield TOKEN.findall(line.get("text", ""))


def main():
    lemma = json.loads((ROOT / "public" / "dict" / "lemma.json").read_text("utf-8"))
    load_verbs()
    phrases = load_phrases(lemma)
    gap_ok = [gappable(t) for t, _, _ in phrases]
    print("词典里的候选短语", len(phrases), flush=True)
    # 前缀树：键是规范后的词；"$" 下挂短语序号
    trie: dict = {}
    for i, (toks, _, _) in enumerate(phrases):
        node = trie
        for t in toks:
            node = node.setdefault(t, {})
        node.setdefault("$", []).append(i)
    count = Counter()
    n_tok = 0
    for toks in corpus_sentences():
        raw = [t.lower().replace("’", "'") for t in toks]
        lem = [lemma.get(t, t) for t in raw]
        n_tok += len(raw)
        def keys_at(k):
            keys = {lem[k], raw[k]}
            if raw[k] in OBJ:
                keys.add("~any")
            if raw[k] in POSS or raw[k].endswith("'s"):
                keys.add("~poss")
            if raw[k] in REFL:
                keys.add("~refl")
            return keys

        # 和前端 src/lib/phrases.ts 一样：动词后面可以隔 1–4 个词再接小品词（cut its entry queues down to → cut down to），
        # 只在试卷里拆开用过的动词短语也要收进来
        def walk(node, k, depth, gap):
            if k >= len(raw) or depth >= 6:
                return
            for key in keys_at(k):
                child = node.get(key)
                if child is None:
                    continue
                for pi in child.get("$", ()):
                    if not gap or gap_ok[pi]:
                        count[pi] += 1
                walk(child, k + 1, depth + 1, gap)
            if depth == 1 and not gap and lem[k - 1] not in ("be", "have", "do"):
                for g in range(1, MAX_GAP + 1):
                    w = raw[k + g - 1] if k + g - 1 < len(raw) else ""
                    if k + g >= len(raw) or w in BREAK or w in PARTICLES or (PARTICIPLE.match(w) and w not in OBJ_WORDS):
                        break
                    if raw[k + g] in SEPARABLE:
                        walk(node, k + g, depth, True)

        for s in range(len(raw)):
            walk(trie, s, 0, False)
    used = sorted(count, key=lambda i: -count[i])
    rows = [[phrases[i][0], phrases[i][1], phrases[i][2], count[i], gap_ok[i]] for i in used]
    OUT.write_text(json.dumps({"v": 1, "p": rows}, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print(f"语料 {n_tok} 词；出现过的短语 {len(rows)} 个；{OUT.stat().st_size / 1024:.0f}KB")
    if "--top" in sys.argv:
        k = int(sys.argv[sys.argv.index("--top") + 1])
        for r in rows[:k]:
            print(r[3], r[1], "—", r[2])


if __name__ == "__main__":
    main()
