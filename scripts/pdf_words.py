"""从 PDF 里按字符坐标重建单词、行和句子，供原卷视图点词查词、提取听力原文用。

考试院大纲这类 PDF 的文字层字符顺序是乱的、字母间距不均匀（两端对齐），直接提取
会变成 "t h i sp a r t"。做法：
1. 取每个字符的坐标，用内嵌字体的字宽算出它和下一个字符的真实间距；
2. 按基线分行；
3. 对每串连续字母，用"间距 + 词典"做动态规划，选出最像真实单词的切分。
"""
import json
import re
import unicodedata
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parent.parent
WORD_CHAR = re.compile(r"[A-Za-z0-9'\-]")
HARD_GAP = 8.0  # 超过这个间距（pt）一定是不同的词
# 这份 PDF 字体编码里的特殊字形
CHAR_MAP = {0x1001B3: "'", 0xFF27: "-"}


def norm(c):
    o = ord(c)
    if o in CHAR_MAP:
        return CHAR_MAP[o]
    return unicodedata.normalize("NFKC", c)


def load_vocab():
    """词表：小写词 -> 词频排名（没有排名记为 0）；变形词用原形的排名"""
    vocab = {}
    for f in (ROOT / "public/dict/shards").glob("*.json"):
        for k, e in json.loads(f.read_text("utf-8")).items():
            vocab[k] = e.get("f", 0)
    for form, base in json.loads((ROOT / "public/dict/lemma.json").read_text("utf-8")).items():
        if not vocab.get(form):
            vocab[form] = vocab.get(base, 0)
    # 有些变形词（based、are）自己有词条但没有词频，用原形的
    shards_forms = {}
    for f in (ROOT / "public/dict/shards").glob("*.json"):
        for k, e in json.loads(f.read_text("utf-8")).items():
            for part in (e.get("x") or "").split("/"):
                kv = part.split(":")
                if len(kv) == 2 and kv[0] in "pdi3rts" and kv[1]:
                    shards_forms.setdefault(kv[1].lower(), k)
    for form, base in shards_forms.items():
        if form in vocab and not vocab[form] and vocab.get(base):
            vocab[form] = vocab[base]
    return vocab


def rank_of(word, vocab):
    w = word.lower().strip("'-")
    if w in vocab:
        return vocab[w]
    for suf in SUFFIXES:
        if w.endswith(suf) and w[: -len(suf)] in vocab:
            return vocab[w[: -len(suf)]]
    return 0


SUFFIXES = ("'s", "'t", "'re", "'ll", "'ve", "'d", "'m")


def known(word, vocab):
    w = word.lower().strip("'-")
    if not w:
        return False
    if w in vocab or re.fullmatch(r"[\d.,%$£]+", w):
        return True
    for suf in SUFFIXES:
        if w.endswith(suf) and w[: -len(suf)] in vocab:
            return True
    if "-" in w:
        return all(part in vocab for part in w.split("-") if part)
    return False


def word_cost(word, vocab):
    if known(word, vocab):
        # 常用词优先：based on 比 base don 好
        rank = rank_of(word, vocab)
        return 0.6 * min(1.0, rank / 15000) if rank else 0.3
    if len(word.strip("'-")) <= 1:
        return 8.0
    return 4.0 + 0.4 * len(word)  # 人名地名等生词，允许但不鼓励


def join_cost(gap):
    return max(0.0, gap - 2.0) * 2


def split_cost(gap):
    # 间距小于 1pt 时都算"没有空格证据"，代价相同，交给词频决定（based on / base don）
    return max(0.0, 3.2 - max(gap, 1.0)) * 2


class Extractor:
    def __init__(self, doc, vocab):
        self.doc = doc
        self.vocab = vocab
        self.fonts = {}
        self.adv = {}  # (字体, 字符) -> 实测字宽（相对字号）

    def calibrate(self, pages):
        """内嵌字体的字宽和实际排版不一致，从这些页里实测每个字符的字宽：
        同一字符到下一个字符的距离，大多数时候是词内（只有字宽），取低分位数。"""
        samples = {}
        for page in pages:
            cs = sorted(self.raw_chars(page), key=lambda c: (round(c["base"]), c["x0"]))
            for a, b in zip(cs, cs[1:]):
                if abs(a["base"] - b["base"]) > 1 or not a["c"].isalnum() or not b["c"].isalnum():
                    continue
                d = (b["x0"] - a["x0"]) / a["size"]
                if 0.1 < d < 1.5:
                    samples.setdefault((a["font"], a["c"]), []).append(d)
        for key, ds in samples.items():
            if len(ds) >= 4:
                ds.sort()
                self.adv[key] = ds[len(ds) // 5]

    def font(self, page, name):
        if name not in self.fonts:
            self.fonts[name] = None
            for f in page.get_fonts():
                if f[3].split("+")[-1] == name:
                    try:
                        self.fonts[name] = fitz.Font(fontbuffer=self.doc.extract_font(f[0])[3])
                    except Exception:
                        pass
                    break
        return self.fonts[name]

    def raw_chars(self, page):
        out = []
        for block in page.get_text("rawdict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    name = span["font"].split("+")[-1]
                    for ch in span["chars"]:
                        if not ch["c"].strip():
                            continue
                        x, base = ch["origin"]
                        out.append({"raw": ch["c"], "c": norm(ch["c"]), "font": name, "x0": x, "y0": ch["bbox"][1], "y1": ch["bbox"][3], "base": base, "size": span["size"]})
        return out

    def chars(self, page):
        out = self.raw_chars(page)
        for ch in out:
            rel = self.adv.get((ch["font"], ch["c"]))
            if rel:
                adv = rel * ch["size"]
            else:
                font = self.font(page, ch["font"])
                adv = font.text_length(ch["raw"], fontsize=ch["size"]) if font else 0
                if adv <= 0:
                    adv = ch["size"] * 0.5
            ch["x1"] = ch["x0"] + adv
        return out

    def lines(self, page):
        chars = sorted(self.chars(page), key=lambda c: (c["base"], c["x0"]))
        groups = []
        for ch in chars:
            for g in groups:
                if abs(g["base"] - ch["base"]) <= ch["size"] * 0.35:
                    g["chars"].append(ch)
                    break
            else:
                groups.append({"base": ch["base"], "chars": [ch]})
        return [self.tokenize(sorted(g["chars"], key=lambda c: c["x0"])) for g in sorted(groups, key=lambda g: g["base"])]

    def tokenize(self, cs):
        """把一行字符切成词和标点，返回 [{t, x0, y0, x1, y1, word, sp}]"""
        gaps = [b["x0"] - a["x1"] for a, b in zip(cs, cs[1:])] + [99.0]
        tokens = []
        i = 0
        while i < len(cs):
            if not WORD_CHAR.match(cs[i]["c"]):
                tokens.append(self.make(cs[i : i + 1], gaps[i - 1] if i else 99.0, False))
                i += 1
                continue
            j = i
            # 字母和数字之间一定断开（and2 -> and 2）
            while j + 1 < len(cs) and WORD_CHAR.match(cs[j + 1]["c"]) and gaps[j] < HARD_GAP and cs[j]["c"].isdigit() == cs[j + 1]["c"].isdigit():
                j += 1
            run = cs[i : j + 1]
            # 紧挨着上一串字母或数字（and2）也算有空格
            after_alnum = i > 0 and cs[i - 1]["c"].isalnum()
            for a, b in self.segment(run, gaps[i:j]):
                # 同一串里切出来的后续词，前面一定有空格
                gap = (99.0 if after_alnum else gaps[i - 1] if i else 99.0) if a == 0 else 99.0
                tokens.append(self.make(run[a:b], gap, True))
            i = j + 1
        return tokens

    def segment(self, run, gaps):
        """动态规划：best[k] = 前 k 个字符的最小代价"""
        n = len(run)
        text = "".join(c["c"] for c in run)
        best = [0.0] + [float("inf")] * n
        back = [0] * (n + 1)
        for end in range(1, n + 1):
            for start in range(max(0, end - 25), end):
                cost = best[start] + word_cost(text[start:end], self.vocab)
                cost += sum(join_cost(g) for g in gaps[start : end - 1])
                if start > 0:
                    cost += split_cost(gaps[start - 1])
                if cost < best[end]:
                    best[end] = cost
                    back[end] = start
        spans = []
        k = n
        while k > 0:
            spans.append((back[k], k))
            k = back[k]
        out = []
        for a, b in spans[::-1]:
            out.extend((a + x, a + y) for x, y in self.refine(text[a:b]))
        return out

    def refine(self, word):
        """粗体标题里词间距几乎为零，DP 会把整串当成一个生词，这里再拆一次：
        驼峰（AnswerSheet）按大写拆；所有格后粘连（passengers'complaints）在撇号后拆；
        全小写且能完整拆成已知词的（basedon）拆开。首字母大写的专有名词（Starbucks）不动。"""
        whole = [(0, len(word))]
        if known(word, self.vocab):
            return whole
        m = re.match(r"^(.+s')([a-z].*)$", word)
        if m:
            k = len(m.group(1))
            return [(0, k), (k, len(word))]
        parts = [(p.start(), p.end()) for p in re.finditer(r"[A-Z][a-z]+|[a-z]+|[A-Z]+(?![a-z])", word)]
        if len(parts) > 1 and all(known(word[x:y], self.vocab) for x, y in parts) and parts[-1][1] == len(word):
            return parts
        if word.islower():
            n = len(word)
            best = {0: []}
            for end in range(2, n + 1):
                for start in range(max(0, end - 20), end - 1):
                    if start in best and known(word[start:end], self.vocab) and (end not in best or len(best[start]) + 1 < len(best[end])):
                        best[end] = best[start] + [(start, end)]
            if n in best and len(best[n]) > 1:
                return best[n]
        return whole

    @staticmethod
    def make(cs, gap_before, is_word):
        text = "".join(c["c"] for c in cs)
        # 字符框的高度包含了行距，按基线和字号算出贴合文字的上下边
        return {
            "t": text,
            "x0": cs[0]["x0"],
            "x1": cs[-1]["x1"],
            "y0": min(c["base"] - c["size"] * 0.8 for c in cs),
            "y1": max(c["base"] + c["size"] * 0.25 for c in cs),
            "word": is_word and bool(re.search(r"[A-Za-z]", text)),
            "sp": gap_before > 1.2,
        }


CLOSE = set(",.;:?!)]”’%")
OPEN = set("([“‘$£")


def line_text(tokens):
    """拼回文字：标点前不加空格，句号逗号后面的词前加空格"""
    s = ""
    for k, t in enumerate(tokens):
        if k:
            prev = tokens[k - 1]["t"]
            if t["t"] in CLOSE or prev in OPEN:
                pass
            elif prev in CLOSE and t["t"][0].isalnum():
                s += " "
            elif t["sp"]:
                s += " "
        s += t["t"]
    return s


ABBR = {"mr", "mrs", "ms", "dr", "st", "u", "s", "no", "vs", "etc", "a", "b", "c", "d"}


def page_data(ex, page):
    """一页的可点击单词和句子：{w: [[词, x0, y0, x1, y1, 句子序号]], s: [句子]}"""
    words, sentences, cur = [], [], []
    tokens = []
    for line in ex.lines(page):
        if tokens and line:
            line[0]["sp"] = True  # 换行处补空格
        tokens.extend(line)
    for k, t in enumerate(tokens):
        cur.append(t)
        if t["word"]:
            t["s"] = len(sentences)
            words.append(t)
        prev = tokens[k - 1]["t"].lower() if k else ""
        if t["t"] in ".?!" and not (t["t"] == "." and (prev in ABBR or prev.isdigit())):
            sentences.append(line_text(cur).strip())
            cur = []
    if cur:
        sentences.append(line_text(cur).strip())
    r = lambda v: round(v, 1)
    return {
        "w": [[t["t"], r(t["x0"]), r(t["y0"]), r(t["x1"]), r(t["y1"]), t["s"]] for t in words],
        "s": sentences,
    }


if __name__ == "__main__":
    import sys

    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    doc = fitz.open(sys.argv[1])
    ex = Extractor(doc, load_vocab())
    ex.calibrate([doc[n - 1] for n in range(int(sys.argv[2]), int(sys.argv[3]) + 1)])
    for n in range(int(sys.argv[2]), int(sys.argv[3]) + 1):
        print(f"===== PAGE {n} =====")
        for tokens in ex.lines(doc[n - 1]):
            print(line_text(tokens))
