"""解析文本校验（给人看）：试卷 JSON 里导入时带的解析（question.explanation），列出可能"串了"的题。

查四类：
  截断    开头像是被切掉了一截：小写字母、逗号句号、"位到""定位到""段第""和 "……开头
  页脚    夹着解析 PDF 的页眉页脚："第 6 页，共 14 页""22年12月四级真题第1套详解""2022.6/ 5 (第 1套)"
  选项    开头抄了四个选项的译文（"A）她在值班。B）她在休假。……"）
  别的题  解析里说的和本题对不上：结论"答案为 X"和答案键不同；段落匹配"定位到 X 段"和答案键不同；
          听力"句(n)"引用的全是别的题号
只读，不改任何文件。导入完、改完解析都跑一遍。

用法：
  python -I scripts/explain_audit.py                 所有四六级试卷，打印每套的数字，写 data/cache/explain-audit.md
  python -I scripts/explain_audit.py cet4-2022-12-1  只看这几套
  python -I scripts/explain_audit.py --json out.json 另外把每题的问题写成 JSON（前后对比用）
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
from cet_answers import FOOTER_ANY  # noqa: E402

PAPERS = ROOT / "public/papers"
OUT_MD = ROOT / "data/cache/explain-audit.md"

TRUNC = re.compile(r"^(?:[a-z]|[，,。.;；:：)）、】\]]|位到|定位到|段第|和\s|的[^确]|句[(（。])")
OPTIONS = re.compile(r"^\s*A\s*[)）]\s*[^【\[]{1,40}?B\s*[)）][^【\[]{1,40}?C\s*[)）]")
CONCLUDE = re.compile(r"(?:故|因此|所以|由此可知|可见)[，,]?\s*(?:本题)?(?:正确)?答案(?:为|是|选)\s*([A-T])(?![A-Za-z])|故本题选\s*([A-T])(?![A-Za-z])")
LOCATE_PARA = re.compile(r"定位到(?:文章)?\s*([A-T])\s*[)）]?\s*段")
SENT_REF = re.compile(r"句\s*[(（]\s*(\d{1,2})(?:\s*-\s*\d)?\s*[)）]")


def problems(n, key, text):
    """一道题的问题列表 [(类别, 说明)]"""
    out = []
    t = text.strip()
    if not t:
        return out
    if TRUNC.match(t):
        out.append(("截断", t[:24]))
    m = FOOTER_ANY.search(t)
    if m:
        out.append(("页脚", m.group(0)[:30]))
    if OPTIONS.match(t):
        out.append(("选项", t[:30]))
    if key:
        said = {g for m in CONCLUDE.finditer(t) for g in m.groups() if g}
        if said and key not in said:
            out.append(("别的题", f"解析结论 {'/'.join(sorted(said))}，答案键 {key}"))
        if 36 <= n <= 45:
            loc = set(LOCATE_PARA.findall(t))
            if loc and key not in loc:
                out.append(("别的题", f"定位到 {'/'.join(sorted(loc))} 段，答案键 {key}"))
    if n <= 25:
        refs = {int(x) for x in SENT_REF.findall(t)}
        if refs and n not in refs:
            out.append(("别的题", f"引用 句({'/'.join(map(str, sorted(refs)))})"))
    return out


def audit(pid):
    d = json.loads((PAPERS / f"{pid}.json").read_text("utf-8"))
    res, total = {}, 0
    for s in d["sections"]:
        for g in s["groups"]:
            for q in g["questions"]:
                n = q.get("number") or 0
                if not n or not q.get("explanation"):
                    continue
                total += 1
                p = problems(n, q.get("answer"), q["explanation"])
                if p:
                    res[n] = p
    return total, res


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="解析文本校验")
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--json", help="每题的问题写到这个文件")
    args = ap.parse_args()
    ids = args.ids or sorted(os.path.basename(p)[:-5] for p in glob.glob(str(PAPERS / "cet*.json")) if "sample" not in p)
    cats = ["截断", "页脚", "选项", "别的题"]
    rows, dump, sums, n_with, n_total = [], {}, {c: 0 for c in cats}, 0, 0
    for pid in ids:
        total, res = audit(pid)
        if not total:
            continue
        n_with += 1
        n_total += total
        cnt = {c: sum(1 for p in res.values() if any(x[0] == c for x in p)) for c in cats}
        for c in cats:
            sums[c] += cnt[c]
        dump[pid] = {str(n): p for n, p in res.items()}
        if res:
            rows.append((pid, total, cnt, res))
            print(f"{pid}  {total} 题有解析：" + "，".join(f"{c} {cnt[c]}" for c in cats if cnt[c]))
    summary = f"{n_with} 套有解析，共 {n_total} 题；" + "，".join(f"{c} {sums[c]} 题" for c in cats)
    print("\n" + summary)
    lines = ["# 解析文本校验", "", summary, "", "| 试卷 | 题号 | 问题 |", "| --- | --- | --- |"]
    for pid, total, cnt, res in rows:
        for n in sorted(res):
            lines.append(f"| {pid} | {n} | " + "；".join(f"{c}：{x}".replace("|", "/") for c, x in res[n]) + " |")
    OUT_MD.parent.mkdir(parents=True, exist_ok=True)
    OUT_MD.write_text("\n".join(lines) + "\n", "utf-8")
    if args.json:
        Path(args.json).write_text(json.dumps({"summary": sums, "sets": n_with, "questions": n_total, "detail": dump}, ensure_ascii=False, indent=1), "utf-8")


if __name__ == "__main__":
    main()
