"""给解析层的结构化字段补"题型 / 一句话结论 / 做题信号 / 错项陷阱"（四六级），批次文件由 AI 写，脚本校验合并。

  status                     列出每套四六级卷子还差多少题没补
  merge <试卷id> <批次.json>  校验并写进 public/papers/explain/<id>.json 的 fields（kind / brief / signal / traps）

批次文件：{"q46": {"kind": "细节", "brief": "选B：……", "signal": "……", "traps": {"A": "无中生有"}}, ...}
输入用 structure_explanations.py prep <id> --all --full 生成（data/cache/structure/inputs/<id>.txt）。
"""
import json, sys, glob, os

ROOT = os.path.join(os.path.dirname(__file__), "..", "public", "papers")
TRAPS = {"偷换对象", "程度篡改", "无中生有", "常识绑架", "因果颠倒", "范围扩大", "张冠李戴", "正反颠倒", "原词照搬", "答非所问", "词性不符", "语义不符"}
KINDS = {"主旨", "细节", "原因", "观点态度", "建议", "推断", "推理", "态度", "词义", "例证", "段落匹配", "词义辨析", "固定搭配", "逻辑关系", "语法", "段落排序"}
LIM = {"brief": 48, "signal": 64}


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def questions(pid):
    out = {}
    for s in load(f"{ROOT}/{pid}.json")["sections"]:
        for g in s["groups"]:
            for q in g["questions"]:
                out[q["id"]] = q
    return out


def merge(pid, batch):
    qs, ex_path = questions(pid), f"{ROOT}/explain/{pid}.json"
    ex, new = load(ex_path), load(batch)
    ok, errs = 0, []
    for qid, v in new.items():
        q, e = qs.get(qid), (ex.get("questions") or {}).get(qid)
        if not q or not e or not e.get("fields") or not isinstance(v, dict):
            errs.append(f"{qid}: 没有这题或这题还没有结构化解析"); continue
        f, ans = e["fields"], q.get("answer") or ""
        letters = {o.get("key") for o in q.get("options") or []}
        kind, brief, signal = (str(v.get(k) or "").strip() for k in ("kind", "brief", "signal"))
        traps = v.get("traps") or {}
        bad = [f"缺 {k}" for k, val in (("kind", kind), ("brief", brief), ("signal", signal)) if not val]
        if kind and not (kind in KINDS or kind.endswith(("词", "式", "数")) or len(kind) <= 8):
            bad.append(f"kind「{kind}」")
        if brief and (len(brief) > LIM["brief"] or (ans and ans not in brief[:6])):
            bad.append("brief 太长或开头没写答案")
        if len(signal) > LIM["signal"]:
            bad.append("signal 超过 64 字")
        if not isinstance(traps, dict) or any(k == ans or k not in letters or t not in TRAPS for k, t in traps.items()):
            bad.append("traps 键必须是错误选项字母、值必须在陷阱表里")
        if bad:
            errs.append(f"{qid}: " + "；".join(bad)); continue
        f.update(kind=kind, brief=brief, signal=signal)
        if traps:
            f["traps"] = traps
        else:
            f.pop("traps", None)  # 改正时写 {} 就是去掉原来的陷阱标签
        ok += 1
    with open(ex_path, "w", encoding="utf-8") as fp:
        json.dump(ex, fp, ensure_ascii=False, indent=1)
    print(f"{pid}: 写入 {ok}，未通过 {len(errs)}")
    for x in errs: print("  " + x)


def status():
    todo = 0
    for p in sorted(glob.glob(f"{ROOT}/explain/cet[46]-*.json")):
        pid = os.path.basename(p)[:-5]
        qs = [v for v in (load(p).get("questions") or {}).values() if v.get("fields", {}).get("answer")]
        left = sum(1 for v in qs if not all(v["fields"].get(k) for k in ("kind", "brief", "signal")))
        todo += left
        print(f"{pid}\t{len(qs) - left}/{len(qs)}")
    print("还差", todo, "题")


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["merge"] and len(a) == 3: merge(a[1], a[2])
    elif a[:1] in (["status"], []): status()
    else: print(__doc__)
