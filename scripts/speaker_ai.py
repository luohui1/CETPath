"""用 AI 子代理按对话内容（轮次、称呼、语气）+ 每句音高参考给对话段补说话人 M/W。先验证再写回。

  python -I scripts/speaker_ai.py prep-val DIR [--n 20]   从说话人齐全的书里对话段抽 N 段，去掉说话人，出 DIR/val.in.txt
  python -I scripts/speaker_ai.py score DIR               读 DIR/val.out.json，按句算准确率（"?"算错）
  python -I scripts/speaker_ai.py prep-fill DIR           给说话人不全的对话段出 DIR/fill.in.txt
  python -I scripts/speaker_ai.py apply DIR [--min 0.95]  验证过线才把 DIR/fill.out.json 写回（只补空句，写 speakerSource:"ai"）
子代理写 {"套id|段id": {"行号": "M"|"W"|"?"}}。行号是该段 lines 的下标。
第二轮（界面"一段每句都有说话人才出角色章"）两种设定，各自验证、各自过线才写：
  python -I scripts/speaker_ai.py prep-anchor DIR [--n 20]   设定 1：说话人齐全的段里随机留约 50% 当锚点（"锚点"列），其余遮住；子代理只标没锚点的行
  python -I scripts/speaker_ai.py score-anchor DIR           只算被遮住那部分的准确率
  python -I scripts/speaker_ai.py score-agree DIR            设定 2：用 val.out.json（全遮）算 AI 和音高分组的逐句一致率；一致率 >=90% 的段叫"一致段"，
                                                             报一致段子集的准确率、一致段占几成
  python -I scripts/speaker_ai.py prep-fill2 DIR             给说话人不齐的对话段出 fill2.in.txt（有锚点的带锚点列）
  python -I scripts/speaker_ai.py apply2 DIR                 设定 1 过线：部分已知段只补空句；设定 2 过线：全空段只在 AI 和音高一致率 >=90% 时整段写；
                                                             写 speakerSource:"ai"
"""
import argparse
import json
import os
import random
import sys
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "1")
sys.path.insert(0, str(Path(__file__).resolve().parent))
import transcript_lint as TL  # noqa: E402
import speaker_pitch as SP  # noqa: E402

HEAD2 = """## 任务：给四六级听力对话的每一句标说话人。每段是一男(M)一女(W)两个播音员的对话，按轮次交替但不一定句句换人（一人可连说几句）。
## 每行格式：行号<TAB>锚点<TAB>音高<TAB>英文。"锚点"列有 M/W 的是已经确定的说话人（不许改、不必输出）；锚点列是 - 的是要你标的。
## 依据：锚点给出的轮次规律、问答关系、称呼、"I'm…/Thanks"等语气、前后文逻辑；"音高"是机器按声音估的参考（M/W/-），可能有错，内容明显矛盾时以内容为准。
## 输出：用 Write 工具写 {OUT}，内容是合法 JSON：{"套id|段id": {"行号": "M"或"W"或"?"}}，只覆盖锚点是 - 的行；真的判断不了的写 "?"，不要硬猜。写完只回复 done。
"""

HEAD = """## 任务：给四六级听力对话的每一句标说话人。每段是一男(M)一女(W)两个播音员的对话，按轮次交替但不一定句句换人（一人可连说几句）。
## 依据：问答关系（问的和答的通常是两个人）、称呼、"I'm…/Thanks"等语气、前后文逻辑；"音高"一栏是机器按声音估的参考（M/W/-，- 表示没把握），可能有错，内容明显矛盾时以内容为准。
## 输出：用 Write 工具写 {OUT}，内容是合法 JSON：{"套id|段id": {"行号": "M"或"W"或"?"}}，覆盖每段所有列出的行；真的判断不了的写 "?"，不要硬猜。写完只回复 done。
## 每行格式：行号<TAB>音高<TAB>英文
"""


def pitch_marks(p, seg):
    try:
        res = SP.predict(p, seg)
    except Exception:
        return {}
    return res[0] if res else {}


def lines_block(pid, p, seg, strip):
    raw = pitch_marks(p, seg)
    out = [f"# {pid}|{seg['id']}"]
    for i, l in enumerate(seg["lines"]):
        if l.get("kind") or not (l.get("text") or "").strip():
            continue
        out.append(f"{i}\t{raw.get(i) or '-'}\t{l['text'].strip()}")
    return "\n".join(out)


def lines_block2(pid, p, seg, anchors):
    """anchors: 保留的锚点行号集合（None = 取段里已有的 speaker）"""
    raw = pitch_marks(p, seg)
    out = [f"# {pid}|{seg['id']}"]
    for i, l in enumerate(seg["lines"]):
        if l.get("kind") or not (l.get("text") or "").strip():
            continue
        a = l.get("speaker") if (anchors is None or i in anchors) and l.get("speaker") in ("M", "W") else None
        out.append(f"{i}\t{a or '-'}\t{raw.get(i) or '-'}\t{l['text'].strip()}")
    return "\n".join(out)


def gold_segments():
    lint = {(r["id"], r["segment"]): r for r in json.loads(TL.OUT.read_text("utf-8"))["segments"]}
    res = []
    for pid, p, seg in SP.conv_segments():
        r = lint.get((pid, seg["id"]), {})
        c = TL.content(seg["lines"])
        if seg.get("source") == "asr" or not c or r.get("speakerCover", 0) < 0.95 or (r.get("timeCorr") or 0) < 0.8 or r.get("garbled", 9) > 1:
            continue
        res.append((pid, p, seg))
    return res


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["prep-val", "score", "prep-fill", "apply", "prep-anchor", "score-anchor", "score-agree", "prep-fill2", "apply2"])
    ap.add_argument("dir")
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--min", type=float, default=0.95)
    ap.add_argument("--exclude", default="")  # 已验证过的 val.keys.json，新抽的不重复
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    d = Path(a.dir)
    d.mkdir(parents=True, exist_ok=True)
    if a.cmd == "prep-anchor":
        g = gold_segments()
        random.Random(11).shuffle(g)
        g = g[:a.n]
        rng = random.Random(5)
        keep = {}
        blocks = []
        for pid, p, seg in g:
            idx = [i for i, l in enumerate(seg["lines"]) if not l.get("kind") and l.get("speaker") in ("M", "W")]
            keep[f"{pid}|{seg['id']}"] = sorted(i for i in idx if rng.random() < 0.5)
            blocks.append(lines_block2(pid, p, seg, set(keep[f"{pid}|{seg['id']}"])))
        (d / "anchor.in.txt").write_text(HEAD2.replace("{OUT}", str((d / "anchor.out.json").resolve())) + "\n".join(blocks) + "\n", "utf-8")
        (d / "anchor.keep.json").write_text(json.dumps(keep), "utf-8")
        print(f"锚点验证集 {len(g)} 段，锚点占 {sum(len(v) for v in keep.values())} 句")
        return
    if a.cmd == "score-anchor":
        out = json.loads((d / "anchor.out.json").read_text("utf-8"))
        keep = json.loads((d / "anchor.keep.json").read_text("utf-8"))
        segs = {f"{pid}|{seg['id']}": seg for pid, p, seg in gold_segments()}
        ok = tot = 0
        for k, m in out.items():
            for i, l in enumerate(segs[k]["lines"]):
                gold = l.get("speaker")
                if l.get("kind") or gold not in ("M", "W") or i in keep[k]:
                    continue
                tot += 1
                ok += m.get(str(i)) == gold
        print(f"遮住的 {tot} 句：准确率 {ok / max(1, tot):.1%}")
        (d / "anchor.score.txt").write_text(f"{ok / max(1, tot):.4f}", "utf-8")
        return
    if a.cmd == "score-agree":
        out = json.loads((d / "val.out.json").read_text("utf-8"))
        segs = {f"{pid}|{seg['id']}": (p, seg) for pid, p, seg in gold_segments()}
        rows = []
        for k, m in out.items():
            p, seg = segs[k]
            res = SP.predict(p, seg)
            if res is None:
                rows.append((k, None, None, 0))
                continue
            final = res[1]
            idx = [i for i in final if final[i]]
            ag = sum(1 for i in idx if m.get(str(i)) == final[i]) / max(1, len(idx))
            gold = [(i, seg["lines"][i].get("speaker")) for i in idx if seg["lines"][i].get("speaker") in ("M", "W")]
            acc = sum(1 for i, g_ in gold if m.get(str(i)) == g_) / max(1, len(gold))
            rows.append((k, ag, acc, len(gold)))
        cons = [r for r in rows if r[1] is not None and r[1] >= 0.9]
        n_ok = sum(r[2] * r[3] for r in cons)
        n_all = sum(r[3] for r in cons)
        acc = n_ok / max(1, n_all)
        print(f"{len(rows)} 段里一致段（一致率>=90%）{len(cons)} 段（{len(cons) / max(1, len(rows)):.0%}）；一致段 {n_all} 句，准确率 {acc:.1%}；音高分不开的段 {sum(1 for r in rows if r[1] is None)}")
        print("各段 一致率/准确率：", [(r[0].split('|')[0][-9:], round(r[1], 2), round(r[2], 2)) for r in rows if r[1] is not None])
        (d / "agree.score.txt").write_text(f"{acc:.4f}", "utf-8")
        return
    if a.cmd == "prep-fill2":
        todo = []
        for pid, p, seg in SP.conv_segments():
            c = TL.content(seg["lines"])
            if c and sum(1 for l in c if l.get("speaker") in ("M", "W")) < len(c):
                todo.append((pid, p, seg))
        (d / "fill2.in.txt").write_text(HEAD2.replace("{OUT}", str((d / "fill2.out.json").resolve())) + "\n".join(lines_block2(pid, p, seg, None) for pid, p, seg in todo) + "\n", "utf-8")
        part = sum(1 for pid, p, seg in todo if any(l.get("speaker") for l in seg["lines"]))
        print(f"待补 {len(todo)} 段（部分已知 {part}，全空 {len(todo) - part}）")
        return
    if a.cmd == "apply2":
        acc1 = float((d / "anchor.score.txt").read_text("utf-8")) if (d / "anchor.score.txt").exists() else 0
        acc2 = float((d / "agree.score.txt").read_text("utf-8")) if (d / "agree.score.txt").exists() else 0
        ok1, ok2 = acc1 >= a.min, acc2 >= a.min
        print(f"设定1（锚点）准确率 {acc1:.1%} {'过线' if ok1 else '不过线'}；设定2（一致段）准确率 {acc2:.1%} {'过线' if ok2 else '不过线'}")
        out = json.loads((d / "fill2.out.json").read_text("utf-8"))
        changed = {}
        n1 = n2 = s2 = s2all = 0
        for pid, p, seg in SP.conv_segments():
            m = out.get(f"{pid}|{seg['id']}")
            if not m:
                continue
            has = any(l.get("speaker") in ("M", "W") for l in seg["lines"])
            if has and not ok1:
                continue
            if not has:
                s2all += 1
                if not ok2:
                    continue
                res = SP.predict(p, seg)
                if res is None:
                    continue
                final = res[1]
                idx = [i for i in final if final[i]]
                if sum(1 for i in idx if m.get(str(i)) == final[i]) / max(1, len(idx)) < 0.9:
                    continue
                s2 += 1
            k = 0
            for i, v in m.items():
                l = seg["lines"][int(i)]
                if v in ("M", "W") and not l.get("speaker") and not l.get("kind"):
                    l["speaker"] = v
                    k += 1
            if k:
                seg["speakerSource"] = "ai"
                changed[pid] = p
                if has:
                    n1 += k
                else:
                    n2 += k
        for p in changed.values():
            TL.save_paper(p)
        print(f"写回：部分已知段补 {n1} 句；全空段 {s2}/{s2all} 段整段写（{n2} 句）")
        return
    if a.cmd == "prep-val":
        g = gold_segments()
        if a.exclude:
            ex = set(json.loads(Path(a.exclude).read_text("utf-8")))
            g = [x for x in g if f"{x[0]}|{x[2]['id']}" not in ex]
        random.Random(a.seed).shuffle(g)
        g = g[:a.n]
        txt = HEAD.replace("{OUT}", str((d / "val.out.json").resolve()))
        txt += "\n".join(lines_block(pid, p, seg, True) for pid, p, seg in g) + "\n"
        (d / "val.in.txt").write_text(txt, "utf-8")
        (d / "val.keys.json").write_text(json.dumps([f"{pid}|{seg['id']}" for pid, p, seg in g]), "utf-8")
        print(f"验证集 {len(g)} 段（说话人齐全的共 {len(gold_segments())} 段）")
    elif a.cmd == "score":
        out = json.loads((d / "val.out.json").read_text("utf-8"))
        ok = tot = unk = 0
        per = []
        segs = {f"{pid}|{seg['id']}": seg for pid, p, seg in gold_segments()}
        for k, m in out.items():
            seg = segs[k]
            a_ = b_ = 0
            for i, l in enumerate(seg["lines"]):
                gold = l.get("speaker")
                if l.get("kind") or gold not in ("M", "W"):
                    continue
                v = m.get(str(i))
                tot += 1; a_ += 1
                if v == "?" or v is None:
                    unk += 1
                elif v == gold:
                    ok += 1; b_ += 1
            per.append((b_ / max(1, a_), k))
        per.sort()
        print(f"{len(out)} 段 {tot} 句：准确率 {ok / max(1, tot):.1%}（其中 ? {unk} 句算错）；最差：{per[:4]}")
        (d / "val.score.txt").write_text(f"{ok / max(1, tot):.4f}", "utf-8")
    elif a.cmd == "prep-fill":
        todo = []
        for pid, p, seg in SP.conv_segments():
            c = TL.content(seg["lines"])
            if c and sum(1 for l in c if l.get("speaker")) / len(c) < 0.8:
                todo.append((pid, p, seg))
        txt = HEAD.replace("{OUT}", str((d / "fill.out.json").resolve()))
        txt += "\n".join(lines_block(pid, p, seg, False) for pid, p, seg in todo) + "\n"
        (d / "fill.in.txt").write_text(txt, "utf-8")
        print(f"待补 {len(todo)} 段")
    else:
        acc = float((d / "val.score.txt").read_text("utf-8"))
        if acc < a.min:
            print(f"验证准确率 {acc:.1%} 不到 {a.min:.0%}，不写")
            return
        out = json.loads((d / "fill.out.json").read_text("utf-8"))
        changed = {}
        n = 0
        for pid, p, seg in SP.conv_segments():
            m = out.get(f"{pid}|{seg['id']}")
            if not m:
                continue
            k = 0
            for i, v in m.items():
                l = seg["lines"][int(i)]
                if v in ("M", "W") and not l.get("speaker") and not l.get("kind"):
                    l["speaker"] = v; k += 1
            if k:
                seg["speakerSource"] = "ai"; changed[pid] = p; n += k
        for p in changed.values():
            TL.save_paper(p)
        print(f"写回 {n} 句，{len(changed)} 套")


if __name__ == "__main__":
    main()
