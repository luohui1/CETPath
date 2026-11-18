"""答案核对（给人用）：把每套卷子的答案键、官方解析正文里说的答案、AI 解析结尾的答案对一遍，列出不一致的题。
目的是让人花十来分钟抽查，不会自动改任何东西；确认键错了，把更正写进 scripts/cet_answer_fixes.json（要写依据）。

三方：
  键      public/papers/<id>.json 里 question.answer
  官方    导入时带进来的官方解析（question.explanation）里说的答案，用 polish_explanations.py 的 ANSWER_SAID 正则取，取最后一个
  AI      解析层 public/papers/explain/<id>.json 里 by 为 "ai" 的条目，同样的正则，另外认 "答案：X" "【答案】X"
  字段    解析层条目里结构化字段 fields.answer（structure_explanations.py 写入的）和键对不对
选词填空（26–35）解析多半只写词、不写字母：另外按原卷的词库（A–O 各是哪个词）核一遍——
  - 词库在原卷 PDF 里取得全吗（15 个字母，每个有词）；
  - 答案字母对应的词，在解析里出现了吗（解析里提到的是词库里别的词，就是疑点）。

用法：
  python -I scripts/answer_audit.py                 全部试卷，打印不一致的题，同时写 data/cache/answer-audit.md
  python -I scripts/answer_audit.py cet4-2024-06-1  只看这几套
  python -I scripts/answer_audit.py --all           连没问题的套也列出来（每套一行汇总）
"""
import argparse
import glob
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from polish_explanations import ANSWER_SAID  # noqa: E402

PAPERS = ROOT / "public/papers"
EXPLAIN = PAPERS / "explain"
OUT_MD = ROOT / "data/cache/answer-audit.md"

# AI 解析里的写法比官方规整，多认几种
AI_SAID = re.compile(r"(?:答案(?:为|是|选|应为)|故选|本题选|应选|因此选|所以选|答案\s*[:：]|【答案】)\s*(?:选项)?\s*([A-O])(?![A-Za-z])")


# 官方解析里另一种常见的结论句："选项C与文章内容一致，因此为正确答案"（ANSWER_SAID 认不出）；只在 ANSWER_SAID 没取到时用
OFF_MORE = re.compile(r"([A-O])\s*(?:项|选项)?[^。！？；A-Za-z]{0,30}?(?:故|因此|所以)?\s*(?:为|是|属于)\s*(?:正确|本题|该题)?\s*(?:答案|选项)")


def said(text, pat=ANSWER_SAID):
    """解析正文里说的答案字母，按出现顺序"""
    out = []
    for m in pat.finditer(text or ""):
        g = next((x for x in m.groups() if x), None)
        if g:
            out.append(g)
    return out


def load(path):
    return json.loads(Path(path).read_text("utf-8"))


# ---------- 选词填空的词库 ----------

OPT = re.compile(r"^([A-O0])[)）](.*)$")


def read_bank(paper):
    """从原卷 PDF 取选词填空的词库：{字母: 词}。取不到返回 {}"""
    import fitz

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import cet_ocr

    fitz.TOOLS.mupdf_display_errors(False)
    sec = next((s for s in paper["sections"] if s["kind"] == "banked"), None)
    if not sec:
        return {}
    pdf = ROOT / "public" / paper["pdf"]["src"].lstrip("/")
    if not pdf.exists():
        return {}
    lo, y_lo = sec["anchor"]["page"], sec["anchor"]["box"][1]
    after = next((s for s in paper["sections"] if s["kind"] == "matching"), None)
    hi, y_hi = (after["anchor"]["page"], after["anchor"]["box"][1]) if after else (lo + 1, 1e9)
    doc = fitz.open(pdf)
    bank = {}
    for pi in range(lo - 1, min(hi, len(doc))):
        for row in cet_ocr.group_rows(cet_ocr.get_words(doc[pi])):
            cur = None
            y = min(w[1] for w in row)
            if (pi + 1 == lo and y < y_lo - 2) or (pi + 1 == hi and y >= y_hi - 2):
                continue  # 词库在 Section A 标题之后、Section B 标题之前（前面是听力题的选项）
            for w in row:
                t = w[4].strip()
                m = OPT.match(t)
                if m:
                    cur = "O" if m.group(1) == "0" else m.group(1)
                    rest = m.group(2)
                    if cur not in bank and re.fullmatch(r"[A-Za-z-]{2,}", rest or ""):
                        bank[cur] = rest
                        cur = None
                    elif cur in bank:
                        cur = None
                    continue
                if cur and cur not in bank and re.fullmatch(r"[A-Za-z-]{2,}", t):
                    bank[cur] = t
                    cur = None
    return bank


def mentions(text, word):
    t = (text or "").lower()
    w = word.lower()
    if len(w) >= 7:
        w = w[: max(5, len(w) - 3)]  # 解析里常写变形
    return bool(re.search(r"(?<![a-z])" + re.escape(w), t))


# ---------- 一套卷子 ----------

def audit_paper(pid):
    paper = load(PAPERS / f"{pid}.json")
    layer = load(EXPLAIN / f"{pid}.json")["questions"] if (EXPLAIN / f"{pid}.json").exists() else {}
    rows, notes = [], []
    stats = {"questions": 0, "keyed": 0, "official": 0, "ai": 0, "fields": 0, "fields_bad": 0, "bad": 0}
    bank = read_bank(paper) if any(s["kind"] == "banked" for s in paper["sections"]) else None
    if bank is not None:
        if len(bank) < 15 or len(set(bank.values())) < 15:
            notes.append(f"原卷词库只取到 {len(bank)} 个（{''.join(sorted(bank))}），选词填空按词核对不完整")
        order = "ABCDEFGHIJKLMNO"
        if bank and [k for k in order if k not in bank][:1] and len(bank) >= 12:
            notes.append(f"词库缺 {''.join(k for k in order if k not in bank)}")
    for sec in paper["sections"]:
        for g in sec["groups"]:
            for q in g["questions"]:
                key = q.get("answer")
                if not key:
                    continue
                stats["questions"] += 1
                stats["keyed"] += 1
                off_text = q.get("explanation") or ""
                ent = layer.get(q["id"], {})
                ai_text = ent.get("text") if ent.get("by") == "ai" else ""
                off = said(off_text) or said(off_text, OFF_MORE)
                ai = said(ai_text, AI_SAID) if ai_text else []
                o, a = (off[-1] if off else None), (ai[-1] if ai else None)
                stats["official"] += o is not None
                stats["ai"] += a is not None
                fa = (ent.get("fields") or {}).get("answer")
                stats["fields"] += fa is not None
                why = []
                if o and o != key:
                    why.append("官方解析说的和键不一致")
                if a and a != key:
                    why.append("AI 解析说的和键不一致")
                if o and a and o != a:
                    why.append("官方和 AI 不一致")
                if fa is not None and fa != key:
                    why.append(f"结构化字段 fields.answer={fa} 和键不一致")
                    stats["fields_bad"] += 1
                if sec["kind"] == "banked" and bank and key in bank:
                    # 解析最后几十个字是结论（"……故选 J) remains。"）：那里提到的词库词，应该是键对应的词
                    word = bank[key]
                    for label, t in (("官方", off_text), ("AI", ai_text)):
                        tail = (t or "")[-70:]
                        if not tail or mentions(t, word) or (label == "官方" and o == key) or (label == "AI" and a == key):
                            continue  # 解析里提到了键对应的词、或者已经写明了字母并且对得上：不算疑点
                        others = sorted(k for k, w in bank.items() if k != key and mentions(tail, w))
                        if len(others) == 1:
                            why.append(f"{label}解析结尾提到词库里的 {others[0]}（{bank[others[0]]}），键 {key} 是 {word}")
                if why:
                    stats["bad"] += 1
                    rows.append({"id": pid, "n": q["number"], "kind": sec["kind"], "key": key, "off": o, "ai": a, "fld": fa, "why": "；".join(why)})
    return rows, notes, stats


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="答案核对")
    ap.add_argument("ids", nargs="*", help="试卷 id；不写就是全部")
    ap.add_argument("--all", action="store_true", help="连没问题的套也列出来")
    args = ap.parse_args()
    ids = args.ids or sorted(os.path.basename(p)[:-5] for p in glob.glob(str(PAPERS / "*.json")) if not p.endswith("index.json"))
    all_rows, md = [], []
    tot = {"questions": 0, "official": 0, "ai": 0, "fields": 0, "fields_bad": 0, "bad": 0}
    for pid in ids:
        try:
            rows, notes, st = audit_paper(pid)
        except Exception as e:
            print(f"{pid}  出错：{type(e).__name__}: {e}")
            continue
        for k in tot:
            tot[k] += st[k]
        all_rows += rows
        if rows or notes or args.all:
            print(f"{pid}  共 {st['questions']} 题，官方解析写明答案 {st['official']}，AI 解析写明答案 {st['ai']}，结构化字段 {st['fields']}（和键不符 {st['fields_bad']}），不一致 {st['bad']}")
            for n in notes:
                print(f"    注：{n}")
            for r in rows:
                print(f"    第 {r['n']:2} 题 [{r['kind']}]  键 {r['key']}  官方 {r['off'] or '-'}  AI {r['ai'] or '-'}  字段 {r['fld'] or '-'}  {r['why']}")
    md.append("# 答案核对\n")
    md.append(f"{len(ids)} 套，{tot['questions']} 题；官方解析写明答案 {tot['official']} 题，AI 解析写明答案 {tot['ai']} 题，结构化字段 {tot['fields']} 题（和键不符 {tot['fields_bad']} 题）；不一致 {tot['bad']} 题。\n")
    md.append("键 = 答案键；官方 = 官方解析正文里说的答案；AI = AI 解析结尾的答案；字段 = fields.answer；`-` 表示没有写明字母。\n")
    md.append("| 试卷 | 题号 | 题型 | 键 | 官方 | AI | 字段 | 说明 |")
    md.append("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for r in all_rows:
        md.append(f"| {r['id']} | {r['n']} | {r['kind']} | {r['key']} | {r['off'] or '-'} | {r['ai'] or '-'} | {r['fld'] or '-'} | {r['why']} |")
    OUT_MD.parent.mkdir(parents=True, exist_ok=True)
    OUT_MD.write_text("\n".join(md) + "\n", "utf-8")
    print(f"\n共 {len(ids)} 套，{tot['questions']} 题，不一致 {tot['bad']} 题（表格写在 {OUT_MD.relative_to(ROOT)}）")


if __name__ == "__main__":
    main()
