"""
整理答案解析：从 public/papers/<id>.json 里导入时带的原始解析出发，清理成统一格式，
写到 public/papers/explain/<id>.json（解析层）。应用加载试卷时把解析层叠上去。

解析层和试卷文件分开放：重新导入试卷不会冲掉整理好的解析和 AI 补写的解析。
可以反复跑：官方解析每次重新整理；AI 写的（by: "ai"）一直保留，想换回官方解析就把那一条删掉再跑。
结构化字段（fields / fieldsBy / fieldsVersion / fieldsFlag，由 structure_explanations.py 写入）不论官方还是 AI 条目，重跑都原样保留。

整理内容：
  - 统一小标题：【定位】【详解】【语法判断】【语义判断】【全文翻译】……，各占一段
  - 去掉 PDF 带进来的残留："答案解析 G。"、行首冒号、末尾的"·听力原文·"、页脚"第 4 页，共 9 页"、汉字间多余空格
  - 粘在一起的英文单词拆开（theworkplace → the workplace），用 ECDICT 的词频
  - 混进最后一题解析里的"全文翻译"拆出来，挂到这一组（这篇文章）上
  - 开头残缺、太短的标记 flag，留给 AI 重写

用法：python scripts/polish_explanations.py [试卷 id ...]
"""

import csv
import glob
import io
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAPERS = os.path.join(ROOT, "public", "papers")
OUT = os.path.join(PAPERS, "explain")
ECDICT = os.path.join(ROOT, "data", "raw", "ecdict", "ecdict.csv")

# ---------- 粘连英文拆词 ----------

_cost: dict[str, float] = {}
_rank: dict[str, int] = {}

FUNCTION_WORDS = """a an the of to in on at by for with as from into than then there here and but or so if not no
is are am was were be been being has have had do does did can may will would should could must shall might
it its we he she they you i me my our his her their them us this that these those who whom whose which what
when where why how all any some more most much many very also just only such own out up about over after"""


def lexicon() -> dict[str, float]:
    """词 → 代价（越常用越小）：按 COCA/BNC 词频排名，Zipf 分布下 cost = log(rank * log N)"""
    if _cost:
        return _cost
    ranks: dict[str, int] = {}
    csv.field_size_limit(10**7)
    with io.open(ECDICT, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            w = row["word"].lower()
            if not w.isalpha() or not w.isascii():
                continue
            r = [int(x) for x in (row["frq"], row["bnc"]) if x and x != "0"]
            rank = min(r) if r else 200_000
            if w not in ranks or rank < ranks[w]:
                ranks[w] = rank
            # 变形（复数、过去式……）也算认识的词，排名跟原形
            for part in (row["exchange"] or "").split("/"):
                if ":" in part:
                    form = part.split(":", 1)[1].lower()
                    if form.isalpha() and form.isascii():
                        ranks[form] = min(ranks.get(form, rank + 1), rank + 1)
    # 解析里常见的缩写；虚词按最常用算（ECDICT 里 are 的排名是"公亩"那个词的）
    ranks.update({"sth": 3000, "sb": 3000})
    for w in FUNCTION_WORDS.split():
        ranks[w] = 10
    _rank.update(ranks)
    n = len(ranks)
    for w, r in ranks.items():
        # 单字母只认 a 和 i，两三个字母的词要足够常用，免得把长词拆成碎片
        if len(w) == 1 and w not in ("a", "i"):
            continue
        if len(w) <= 3 and r > 20_000:
            continue
        _cost[w] = math.log((r + 1) * math.log(n))
    return _cost


def split_joined(token: str) -> str:
    """一个没有空格的长串，如果它本身不是词、又能拆成几个常见词，就拆开（保留原来的大小写）"""
    low = token.lower()
    cost = lexicon()
    if len(token) < 6 or low in cost:
        return token
    n = len(low)
    best = [0.0] + [math.inf] * n
    back = [0] * (n + 1)
    for i in range(1, n + 1):
        for j in range(max(0, i - 20), i):
            c = cost.get(low[j:i])
            if c is not None and best[j] + c < best[i]:
                best[i], back[i] = best[j] + c, j
    if math.isinf(best[n]):
        return token
    parts, i = [], n
    while i > 0:
        parts.append(token[back[i] : i])
        i = back[i]
    parts.reverse()
    # 每一段都得是常见词才拆：拼错的词（milions）和生僻词（crocheters）宁可不拆
    common = all(_rank.get(p.lower(), 10**9) <= (5_000 if len(p) <= 3 else 40_000) for p in parts)
    return " ".join(parts) if len(parts) > 1 and common else token


def fix_english(text: str) -> str:
    text = re.sub(r"[A-Za-z]{6,}", lambda m: split_joined(m.group(0)), text)
    # 范文里句末的批注序号：areas.1 Moreover
    text = re.sub(r"(?<=[a-z][.!?])\d{1,2}(?=\s|$)", "", text)
    # 英文标点后面丢了的空格：students.Opening、environment,potentially
    text = re.sub(r"(?<=[a-z]{2})([.!?])(?=[A-Z][a-z])", r"\1 ", text)
    return re.sub(r"(?<=[a-z]{2}),(?=[a-z]{2})", ", ", text)


# ---------- 清理 ----------

CJK = r"一-鿿　-〿＀-￯“”‘’—…"

LABELS = ["定位", "详解", "语法判断", "语义判断", "全文翻译", "答案解析", "解析", "考点", "干扰项", "排除"]


def tidy(text: str) -> str:
    t = text.replace("\r", "").replace("　", " ")
    t = re.sub(r"第\s*\d+\s*页\s*[，,]\s*共\s*\d+\s*页", "", t)  # 页脚
    t = re.sub(r"[ \t]*·\s*[一-鿿]{2,6}\s*·[ \t]*$", "", t)  # 末尾的下一节标题，如"·听力原文·"
    t = re.sub(r"—-|-—", "——", t)
    t = t.replace("填人", "填入").replace("代人", "代入")  # 扫描件识别错的"入"
    t = re.sub(rf"(?<=[{CJK}])[ \t]+(?=[{CJK}])", "", t)  # 汉字之间的空格（PDF 换行留下的）
    t = re.sub(rf"(?<=[{CJK}])[ \t]+(?=[，。；：、）])", "", t)
    t = fix_english(t)
    t = re.sub(r"[ \t]{2,}", " ", t)
    return t.strip()


def structure(text: str) -> str:
    """统一小标题：每个小标题另起一段，写成【定位】……"""
    t = text
    t = re.sub(r"^答案解析\s*[A-O]\)?\s*[。.]?", "", t)  # 长篇阅读开头的"答案解析 G。"
    t = re.sub(r"^\s*[:：]\s*", "", t)  # 标签丢了只剩冒号
    t = re.sub(r"^定(?=根据|由|从)", "【定位】", t)  # "定位"的"位"丢了
    t = re.sub(r"^\[?(语法判断|语义判断)\]?\s*", r"【\1】", t)
    t = re.sub(r"\s*解→\s*(?:年(?=第))?", "\n【详解】", t)  # "详解"的"详"丢了，剩个箭头
    for label in LABELS:
        # 段中的"详解：""语义判断"等，前面断开
        t = re.sub(rf"\s*(?<!【)\[?{label}\]?\s*[:：]\s*", f"\n【{label}】", t)
    t = re.sub(r"(?<=[。！？])\s*\[?(语法判断|语义判断)\]?\s*(?=[^】])", r"\n【\1】", t)
    t = re.sub(r"[【\[［]([一-鿿]{2,6})[］\]】]", r"【\1】", t)  # 括号配错的小标题
    t = t.replace("【答案解析】", "").replace("【解析】", "")
    t = re.sub(r"\n{2,}", "\n", t).strip()
    return t


def split_translation(text: str) -> tuple[str, str | None]:
    """最后一题的解析后面常带着整篇文章的翻译，拆出来"""
    m = re.search(r"\n?【全文翻译】", text)
    if not m:
        return text, None
    return text[: m.start()].strip(), text[m.end() :].strip() or None


# structure_explanations.py 写进来的结构化字段：整理文本时不能丢
FIELD_KEYS = ("fields", "fieldsBy", "fieldsVersion", "fieldsFlag")

ANSWER_SAID = re.compile(r"(?:答案(?:为|是|选|应为)|故选|本题选|应选|因此选|所以选)\s*(?:选项)?\s*([A-O])(?![A-Za-z])|选项\s*([A-O])\s*(?:为|是)正确答案|([A-O])\)?\s*项?为正确答案")


def flag_of(text: str, kind: str, answer: str | None = None) -> str | None:
    if kind in ("translation", "writing"):
        return None  # 主观题的解析是考点提示，旁边有参考答案，短一点没关系
    if len(text) < 20:
        return "short"
    # 解析最后说的答案和答案键对不上：多半是解析张冠李戴（解析 PDF 里题号错位）
    said = [next(g for g in m.groups() if g) for m in ANSWER_SAID.finditer(text)]
    if answer and said and said[-1] != answer:
        return "mismatch"
    # 结尾没有句号，后半截丢了
    if len(text) > 40 and not re.search(r"[。！？”）)」.!?…]$", text):
        return "cut"
    first = re.sub(r"^【[^】]+】", "", text)[:1]
    # 开头就是英文小写字母或标点，多半是前一页的内容丢了
    if re.match(r"[a-z,.;)）]", first):
        return "truncated"
    # 题干引文和"定位到原文画线处"搅在一起了
    if re.search(r"原文画(?!线)", text) or re.search(r"[A-Za-z ,.'’]{240,}", text):
        return "garbled"
    if kind != "listening" and not re.search(r"答案|选|故|定位|填|因此|所以", text):
        return "unclear"
    return None


def polish_paper(path: str) -> dict:
    pid = os.path.basename(path)[:-5]
    with io.open(path, encoding="utf-8") as f:
        paper = json.load(f)
    out_path = os.path.join(OUT, f"{pid}.json")
    old = {}
    if os.path.exists(out_path):
        with io.open(out_path, encoding="utf-8") as f:
            old = json.load(f)
    old_q = old.get("questions", {})
    old_g = old.get("groups", {})

    questions, groups = {}, {}
    stats = {"official": 0, "ai": 0, "flagged": 0, "missing": 0}
    for sec in paper["sections"]:
        for g in sec["groups"]:
            for q in g["questions"]:
                entry = {}
                raw = (q.get("explanation") or "").strip()
                if raw:
                    text, translation = split_translation(structure(tidy(raw)))
                    if translation:
                        groups[g["id"]] = {"translation": translation, "by": "official"}
                    entry = {"text": text, "by": "official"}
                    flag = flag_of(text, sec["kind"], q.get("answer"))
                    prev = old_q.get(q["id"], {})
                    if prev.get("by") == "ai":
                        # AI 写过的都核对过答案、是完整的，一直用它；官方这条可能是识别乱码而没被标出来
                        entry = dict(prev)
                    elif flag:
                        entry["flag"] = flag
                elif old_q.get(q["id"], {}).get("by") == "ai":
                    entry = dict(old_q[q["id"]])
                if q.get("reference"):
                    entry["reference"] = tidy(q["reference"])
                    entry.setdefault("by", "official")
                elif old_q.get(q["id"], {}).get("reference"):
                    entry["reference"] = old_q[q["id"]]["reference"]
                # 结构化字段：官方、AI 条目一视同仁，原样带回来
                prev_entry = old_q.get(q["id"], {})
                kept = {k: prev_entry[k] for k in FIELD_KEYS if k in prev_entry}
                if kept:
                    if not entry:
                        entry = {k: prev_entry[k] for k in ("text", "by", "flag") if k in prev_entry}
                    entry.update(kept)
                if entry:
                    questions[q["id"]] = entry
                    stats["ai" if entry.get("by") == "ai" else "official"] += 1
                    stats["flagged"] += bool(entry.get("flag"))
                else:
                    stats["missing"] += 1
            if g["id"] not in groups and old_g.get(g["id"]):
                groups[g["id"]] = old_g[g["id"]]

    os.makedirs(OUT, exist_ok=True)
    with io.open(out_path, "w", encoding="utf-8") as f:
        json.dump({"id": pid, "questions": questions, "groups": groups}, f, ensure_ascii=False, indent=1)
    return stats


def main(ids: list[str]):
    paths = [os.path.join(PAPERS, f"{i}.json") for i in ids] if ids else sorted(p for p in glob.glob(os.path.join(PAPERS, "*.json")) if not p.endswith("index.json"))
    total = {"official": 0, "ai": 0, "flagged": 0, "missing": 0}
    for p in paths:
        s = polish_paper(p)
        for k in total:
            total[k] += s[k]
        print(f"{os.path.basename(p)[:-5]:24} 官方 {s['official']:3}  AI {s['ai']:3}  待重写 {s['flagged']:3}  缺 {s['missing']:3}")
    print("合计", total)


if __name__ == "__main__":
    main(sys.argv[1:])
