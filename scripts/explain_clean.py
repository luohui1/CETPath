"""官方解析文本（扫描识别）清理：统一小标题、标点，删页眉和图标残字，改常见的形近错字。
解析层 public/papers/explain/<id>.json → questions[qid].text（by=official 的）。

两种来源：
  1) 人工 / 代理逐条校对过的文本（--proofread 目录：out/bNN/p*.jsonl，每行 {pid,qid,text}，对应 in/bNN.jsonl 的原文）；
     跟原文差得太多又不是"只删不改"的不收，回退到 2)。
  2) 没校对过的：只用下面的规则（规则对校对过的文本再跑一遍也不会改坏，结果不变）。
原文第一次改之前存进 questions[qid].textRaw，以后可以对照或者重来。
解析末尾附的整篇参考译文挪到题组的 groups[gid].translation（界面"全文翻译"），文章来源、结构框图不要。

  python -I scripts/explain_clean.py stats [--proofread DIR]     统计会改多少条（不写）
  python -I scripts/explain_clean.py show <pid> <qid> [--proofread DIR]
  python -I scripts/explain_clean.py apply [--proofread DIR]     写回
"""
import argparse
import difflib
import glob
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXPLAIN = ROOT / "public" / "papers" / "explain"
sys.stdout.reconfigure(encoding="utf-8")

C = r"[一-鿿]"
LABELS = "定位|详解|解析|答案精析|设题要点|语法判断|语义判断|语意判断|考点|点睛|做题提示|解题思路|听前预测|干扰项|答案|思路点拨|难句分析|长难句|命题思路|解题技巧|拓展|拓展延伸"

# 形近错字：只收确定不会改坏的写法（前后字一起写死，或者整词）
FIXED = [
    ("语意判断", "语义判断"), ("自已", "自己"), ("一已之", "一己之"), ("持已见", "持己见"), ("知已", "知己"),
    ("一代入", "一代人"), ("眼晴", "眼睛"), ("疲备", "疲惫"), ("词辩析", "词辨析"), ("辩析题", "辨析题"),
    ("敦优敦劣", "孰优孰劣"), ("符号句意", "符合句意"), ("题千", "题干"), ("执择", "抉择"), ("偏祖", "偏袒"),
    ("洪滞", "洪涝"), ("变暧", "变暖"), ("昂责", "昂贵"), ("误人歧途", "误入歧途"), ("引人人胜", "引人入胜"),
    ("系统词", "系动词"), ("宜传", "宣传"), ("需哟啊", "需要"), ("题子中", "题干中"), ("题于中", "题干中"),
]
# "X人" 其实是 "X入"：这些字后面跟"人"几乎都是"入"（"引人""加人"这类可能是真的"人"，不收）
RU = "摄融涌深陷收编沉输投纳渗侵混卷嵌植插汇潜闯踏坠跌堕录"
# "X干" 其实是 "X于"（"题干""主干""若干"不在里面）
YU = "关利衷属由等善易敢处位源基归趋致终至勇急对在"
SENT = re.compile(r"第([一二三四五六七八九十\d]+)旬")


def rules(t: str) -> str:
    s = t
    # 页眉、图标残字、乱符号
    s = re.sub(r"[·•]\s*20\d\d\s*年\s*\d+\s*月[^·•\n]{0,12}真题[^·•\n]{0,8}[·•]", "", s)
    s = re.sub(r"[■◆◇□▲△●○◎※\U00100000-\U0010FFFF]", "", s)  # 图标和私有区乱码
    s = re.sub(r"—_+—*|_—+|—{3,}", "", s)
    s = re.sub(r"(匡国|匮困)", "", s)
    # 卖家广告（"认准光速考研工作室淘宝店铺：光速考研工作室"）
    s = re.sub(r"(?:认准)?\s*(?:光速考研工作室)?\s*淘宝店铺\s*[：:∶]?\s*(?:光速考研工作室)?", "", s)
    # 有一家书"答案为"前面的图标被识别成"匮蜀""医困""匮E""寇→"这类字
    s = re.sub(r"[匮医匡寇][^\s答。，]{0,2}\s*(?=答案为)", "", s)
    s = re.sub(r"寇\s*→\s*", "", s)
    # "00" 被识别成 "∞"（"1 ∞0 美元"、"1 2∞美元"），数字中间多出来的空格去掉
    s = s.replace("∞", "00")
    s = re.sub(r"(?<=\d) (?=\d{1,3}(?:\D|$))", "", s)
    s = fix_latin(s)
    s = s.replace("∶", "：")
    s = re.sub(r"(\d)\?\?", r"\1%", s)  # 百分号被识别成 ??
    s = re.sub(rf"(?<={C})\*(?={C})", "，", s)  # 有一家书的逗号被识别成 *
    s = re.sub(rf"(?<={C})\?", "？", s)
    # 英文双引号成对出现在中文里：换成中文引号（单数个说明有残缺，不动）
    if s.count('"') % 2 == 0 and re.search(C, s):
        k = [0]

        def q(_m):
            k[0] += 1
            return "“" if k[0] % 2 else "”"

        s = re.sub('"', q, s)
    for a, b in FIXED:
        s = s.replace(a, b)
    s = re.sub(rf"([{RU}])人(?={C})", r"\1入", s)
    s = re.sub(rf"([{YU}])干(?={C})", r"\1于", s)
    s = SENT.sub(r"第\1句", s)
    # 小标题：【定位】/[定位]/定位：/定位;/答案精析〕… → 另起一行的【定位】
    s = re.sub(rf"[\[【〔(（]\s*({LABELS})\s*[\]】〕)）]\s*[：:;；]?\s*", lambda m: f"\n【{m.group(1)}】", s)
    # 只剩一边括号的："答案精析〕"、"[设题要点"
    s = re.sub(rf"(?<!【)({LABELS})\s*[\]】〕]\s*[：:;；]?\s*", lambda m: f"\n【{m.group(1)}】", s)
    s = re.sub(rf"[\[〔]\s*({LABELS})(?![\]】〕])\s*[：:;；]?\s*", lambda m: f"\n【{m.group(1)}】", s)
    s = re.sub(rf"(?:(?<=^)|(?<=[。！？\s]))({LABELS})\s*[：:;；]\s*", lambda m: f"\n【{m.group(1)}】", s)
    s = s.replace("【语意判断】", "【语义判断】")
    # 中文之间的半角标点改全角
    s = re.sub(rf"(?<={C}),\s*(?={C})", "，", s)
    s = re.sub(rf"(?<={C});\s*(?={C})", "；", s)
    s = re.sub(rf"(?<={C}):\s*(?={C})", "：", s)
    s = re.sub(rf"(?<={C}),\s*", "，", s)
    # 空白：行内多个空格并成一个，去掉每行首尾空白和空行
    s = re.sub(r"[ \t　]{2,}", " ", s)
    s = "\n".join(x.strip() for x in s.split("\n") if x.strip())
    # 第一个小标题前面是抄进来的选项（至少两个 A)/B)… 选项记号）：整段去掉
    m = re.match(r"^([^\n]*)\n(?=【)", s)
    if m and len(re.findall(r"(?:^|[\s。．.！])[A-D][)）]", m.group(1))) >= 2:
        s = s[m.end():]
    return drop_options(s)


TAIL = re.compile(r"\n?【?(参考译文|全文翻译|译文|文章来源|结构框图|篇章结构)】?\s*[：:]?\s*")


def split_tail(s):
    """一篇的最后一题解析后面常附了整篇参考译文、文章来源、结构框图：切出来。
    返回 (解析正文, 整篇译文或 "")；文章来源、结构框图不要"""
    ms = [m for m in TAIL.finditer(s) if m.start() >= 30 and (m.group(1) != "译文" or m.group(0).startswith(("\n", "【")))]
    if not ms:
        return s, ""
    body = s[: ms[0].start()].rstrip()
    trans = ""
    for i, m in enumerate(ms):
        if m.group(1) in ("参考译文", "全文翻译", "译文"):
            end = ms[i + 1].start() if i + 1 < len(ms) else len(s)
            trans = s[m.end():end].strip()
            break
    return body, trans


OPT = re.compile(r"(?:^|(?<=[\s。．.！？?]))([A-D0])\s?[)）]")


def drop_options(s):
    """开头抄了题目和四个选项（"……？ A) …。 B) …。 C) …。 D) …。"，两栏排版时顺序可能是 A C B D）：
    开头 120 字内出现选项记号、前 400 字里有 3 个以上不同的选项字母，就删到最后一个选项那句的句号为止"""
    head = s[:400]
    ms = list(OPT.finditer(head))
    if not ms:
        return s
    # 只看从第一个记号开始、一个接一个（相隔 ≤80 字、字母不重复）的那一串选项；
    # 后面正文里分析选项时又提到的 A) / D) 不算
    run = [ms[0]]
    seen = {ms[0].group(1).replace("0", "D")}
    for m in ms[1:]:
        letter = m.group(1).replace("0", "D")
        if m.start() - run[-1].end() > 80 or letter in seen:
            break
        run.append(m)
        seen.add(letter)
    letters = {m.group(1).replace("0", "D") for m in run}
    # 一般要 3 个不同字母、从开头 120 字内开始；上一题串进来的半截（开头 30 字内就是选项）2 个也算
    if not (len(letters) >= 3 and run[0].start() <= 120 or len(letters) >= 2 and run[0].start() <= 30):
        return s
    ms = run
    end = s.find("。", ms[-1].end())
    if end < 0 or end > 480:
        return s
    rest = s[end + 1:].lstrip()
    return rest if len(rest) >= 20 else s


_DICT = None


def fix_latin(s):
    """英文词里的扫描错字：词典里没有、换掉一个常见的形近字母（J/I/1→l，0→o，rn→m，vv→w）以后在词典里的，就换"""
    global _DICT
    if _DICT is None:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import transcript_lint as TL

        _DICT = TL.in_dict

    def one(m):
        w = m.group(0)
        if _DICT(w) or w[:1].isupper() and w[1:].islower():
            return w
        for a, b in (("J", "l"), ("I", "l"), ("1", "l"), ("0", "o"), ("rn", "m"), ("vv", "w")):
            if a in w[1:]:
                c = w[0] + w[1:].replace(a, b)
                if _DICT(c):
                    return c
        return w

    return re.sub(r"\b[a-z][A-Za-z01]{2,}\b", one, s)


def load_proofread(d):
    if not d:
        return {}
    d = Path(d)
    src = {}
    for f in sorted(glob.glob(str(d / "in" / "b*.jsonl"))):  # 后面的批次（补校的 b29 起）覆盖前面的原文
        for l in open(f, encoding="utf-8"):
            r = json.loads(l)
            src[(r["pid"], r["qid"])] = r["text"]
    out = {}
    for f in glob.glob(str(d / "out" / "b*" / "p*.jsonl")):
        for l in open(f, encoding="utf-8"):
            if l.strip():
                r = json.loads(l)
                out[(r["pid"], r["qid"])] = (src.get((r["pid"], r["qid"])), r["text"])
    return out


def accept(orig, new):
    """校对结果收不收：差得不多，或者主要是删（新文本的字基本都能在原文里按顺序找到）"""
    if orig is None:
        return False
    if new == "":
        return True  # 整条都是抄进来的题目选项
    sm = difflib.SequenceMatcher(None, orig, new, autojunk=False)
    if sm.ratio() >= 0.75:
        return True
    kept = sum(b.size for b in sm.get_matching_blocks())
    return kept >= 0.92 * len(new)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["stats", "show", "apply"])
    ap.add_argument("args", nargs="*")
    ap.add_argument("--proofread")
    a = ap.parse_args()
    pr = load_proofread(a.proofread)
    n = changed = from_pr = rejected = 0
    moved = 0
    for f in sorted(EXPLAIN.glob("*.json")):
        pid = f.stem
        data = json.loads(f.read_text("utf-8"))
        dirty = False
        # 题 → 题组（解析末尾附的整篇译文挪到题组的"全文翻译"）
        gid_of = {}
        pf = ROOT / "public" / "papers" / f"{pid}.json"
        if pf.exists():
            paper = json.loads(pf.read_text("utf-8"))
            if isinstance(paper, dict):
                for s in paper.get("sections", []):
                    for g in s.get("groups", []):
                        for qq in g.get("questions", []):
                            gid_of[qq["id"]] = g["id"]
        groups = data.setdefault("groups", {})
        for qid, q in data.get("questions", {}).items():
            if q.get("by") != "official" or not q.get("text") and "textRaw" not in q:
                continue
            raw = q.get("textRaw", q.get("text"))
            n += 1
            got = pr.get((pid, qid))
            if got and accept(raw if got[0] is None else got[0], got[1]):
                new = rules(got[1]) if got[1] else ""
                from_pr += 1
            else:
                if got:
                    rejected += 1
                new = rules(raw)
            new, tail = split_tail(new)
            gid = gid_of.get(qid)
            if tail and gid and len(tail) >= 80 and not (groups.get(gid) or {}).get("translation"):
                if a.cmd == "apply":
                    groups[gid] = {**(groups.get(gid) or {}), "translation": rules(tail), "translationBy": "official"}
                    dirty = True
                moved += 1
            if a.cmd == "show" and a.args == [pid, qid]:
                print("原文：", raw, "\n\n校对：", got and got[1], "\n\n结果：", new)
                return
            if new != q.get("text"):
                changed += 1
                if a.cmd == "apply":
                    q["textRaw"] = raw
                    q["text"] = new
                    dirty = True
        if dirty:
            f.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"官方解析 {n} 条；用校对结果 {from_pr} 条，校对结果不收 {rejected} 条；{'改了' if a.cmd == 'apply' else '会改'} {changed} 条；整篇译文挪到题组 {moved} 篇")


if __name__ == "__main__":
    main()
