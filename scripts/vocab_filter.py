"""解析卡"生词"去掉太基础的词：初中词（词典 tags 里有 zk），以及只在高考词表、又是常用词（词频排名前 3000）的词。
四六级 / 考研词表里有、但不是初中词的照样保留（evidence、budget 这类）。词典是 public/dict（ECDICT），变形词先还原成原形再查。

只改 public/papers/explain/<id>.json 里 questions[qid].fields.vocab；去掉的词记在 fields.vocabDropped（以后想放回来有据可查）。
重复跑不会多删（已经过滤过的列表再过滤一次结果一样）。

  python -I scripts/vocab_filter.py stats      只统计
  python -I scripts/vocab_filter.py apply      写回
"""
import glob
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DICT = ROOT / "public" / "dict"
EXPLAIN = ROOT / "public" / "papers" / "explain"

sys.stdout.reconfigure(encoding="utf-8")


def load_dict():
    d = {}
    for f in glob.glob(str(DICT / "shards" / "*.json")):
        x = json.loads(Path(f).read_text("utf-8"))
        for e in (x.values() if isinstance(x, dict) else x):
            if isinstance(e, dict) and "w" in e:
                d.setdefault(e["w"].lower(), e)
    lemma = json.loads((DICT / "lemma.json").read_text("utf-8"))
    return d, lemma


D, LEMMA = load_dict()


def entries(w):
    """这个词自己的词条和原形的词条（habits 自己有词条但没标词表，要看 habit 的）"""
    w = w.lower().strip()
    out = [D[w]] if w in D else []
    l = LEMMA.get(w)
    if isinstance(l, str) and l in D:
        out.append(D[l])
    return out


def basic(w):
    if " " in w.strip():  # 词组保留
        return False
    es = entries(w)
    if not es:
        return False
    tags = set().union(*(e.get("tags") or [] for e in es))
    e = es[-1]
    if "zk" in tags:
        return True
    exam = tags & {"cet4", "cet6", "ky", "toefl", "ielts", "gre"}
    return "gk" in tags and not exam and (e.get("f") or 99999) <= 3000


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "stats"
    total = dropped = files = 0
    for f in sorted(EXPLAIN.glob("*.json")):
        raw = f.read_text("utf-8")
        data = json.loads(raw)
        changed = False
        for q in data.get("questions", {}).values():
            fl = q.get("fields") or {}
            v = fl.get("vocab")
            if not v:
                continue
            keep = [x for x in v if not basic(x.get("w", ""))]
            gone = [x for x in v if basic(x.get("w", ""))]
            total += len(v)
            dropped += len(gone)
            if gone:
                fl["vocab"] = keep
                fl["vocabDropped"] = (fl.get("vocabDropped") or []) + gone
                changed = True
        if changed and cmd == "apply":
            # 解析层一直是 indent=1（polish_explanations.py 的写法），保持一致免得整文件都算改动
            f.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", "utf-8")
            files += 1
    print(f"生词共 {total} 个，去掉 {dropped} 个" + (f"，写回 {files} 个文件" if cmd == "apply" else ""))


if __name__ == "__main__":
    main()
