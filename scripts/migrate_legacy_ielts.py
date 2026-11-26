#!/usr/bin/env python3
"""将旧版独立雅思站点 (sync.sqlite3 或导出 JSON) 的单用户记录幂等迁移至英语之道 yingyu.db 指定账户。

支持的数据范围：
1. kv["mock:<id>"] + 关联单科 attempts -> 合并为 scope="full" 的 ieltsAttempts 记录；
2. 独立单科 attempts -> 转换为 scope=skill 的 ieltsAttempts 记录（保留答案、作文、标记、高亮、计时与 Band）；
3. 已交卷的听力/阅读记录（若本地存在 public/ielts/{papers,keys}）-> 自动重算错题写入 ieltsMastery 并累加 days 打卡统计；
4. kv["speaking:progress"] -> 拆分为逐题 ieltsSpeaking 进度与收藏记录。

幂等保证：同一份数据源对同一 uid 重复执行不会重复累加序号或重复覆盖更新的数据。
"""
from __future__ import annotations

import argparse
import contextlib
import datetime
import json
import math
import pathlib
import re
import sqlite3
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))
import agent_server as srv  # noqa: E402

ORDER = ["listening", "reading", "writing"]

LISTENING_BANDS = [
    (39, 9.0), (37, 8.5), (35, 8.0), (32, 7.5), (30, 7.0),
    (26, 6.5), (23, 6.0), (18, 5.5), (16, 5.0), (13, 4.5),
    (10, 4.0), (8, 3.5), (6, 3.0), (4, 2.5),
]
READING_AC_BANDS = [
    (39, 9.0), (37, 8.5), (35, 8.0), (33, 7.5), (30, 7.0),
    (27, 6.5), (23, 6.0), (19, 5.5), (15, 5.0), (13, 4.5),
    (10, 4.0), (8, 3.5), (6, 3.0), (4, 2.5),
]
READING_GT_BANDS = [
    (40, 9.0), (39, 8.5), (37, 8.0), (36, 7.5), (34, 7.0),
    (32, 6.5), (30, 6.0), (27, 5.5), (23, 5.0), (19, 4.5),
    (15, 4.0), (12, 3.5), (9, 3.0), (6, 2.5),
]


def round_band(avg: float) -> float:
    frac = avg - math.floor(avg)
    if frac < 0.25:
        return float(math.floor(avg))
    if frac < 0.75:
        return math.floor(avg) + 0.5
    return float(math.ceil(avg))


def calc_band(skill: str, raw: int, total: int, gt: bool) -> float | None:
    if not total or skill not in ("listening", "reading"):
        return None
    scaled = round(raw * 40 / total)
    table = LISTENING_BANDS if skill == "listening" else (READING_GT_BANDS if gt else READING_AC_BANDS)
    for need, b in table:
        if scaled >= need:
            return b
    return 2.0 if scaled > 0 else 0.0


def norm_fill(s: object) -> str:
    t = str(s or "").lower()
    t = re.sub(r"[\u2018\u2019`]", "'", t)
    t = re.sub(r'[.,;:!?"()]', " ", t)
    t = re.sub(r"\s*-\s*", "-", t)
    return re.sub(r"\s+", " ", t).strip()


def expand_parens(s: str) -> list[str]:
    m = re.search(r"\(([^()]+)\)", s)
    if not m:
        return [s]
    before, inner, after = s[: m.start()], m.group(1), s[m.end() :]
    return [*expand_parens(before + after), *expand_parens(before + inner + after)]


def fill_variants(raw: object) -> set[str]:
    out: set[str] = set()
    for part in re.split(r"\s*(?:/|\||\bor\b)\s*", str(raw or ""), flags=re.I):
        for ex in expand_parens(part):
            n = norm_fill(ex)
            if n:
                out.add(n)
                out.add(re.sub(r"^(?:a|an|the)\s+", "", n))
                if "-" in n:
                    out.add(n.replace("-", " "))
                    out.add(n.replace("-", ""))
    return {x for x in out if x}


def match_fill(user: object, accepted: list) -> bool:
    u = norm_fill(user)
    if not u:
        return False
    u_forms = {u, re.sub(r"^(?:a|an|the)\s+", "", u)}
    if "-" in u:
        u_forms.add(u.replace("-", " "))
        u_forms.add(u.replace("-", ""))
    for a in accepted or []:
        if u_forms & fill_variants(a):
            return True
    return False


def norm_token(v: object, qtype: str) -> str:
    s = str(v or "").strip().upper()
    if qtype == "tfng":
        if s in ("T", "TRUE"):
            return "TRUE"
        if s in ("F", "FALSE"):
            return "FALSE"
        if s in ("Y", "YES"):
            return "YES"
        if s in ("N", "NO"):
            return "NO"
        if s in ("NG", "NOT GIVEN", "NOTGIVEN"):
            return "NOT GIVEN"
    return s


def grade_paper_section(
    paper_parts: list[dict],
    key_parts: list[dict],
    answers: dict[str, object],
) -> tuple[int, int, list[dict]]:
    raw_total = 0
    max_total = 0
    units: list[dict] = []
    key_by_part = {p["part"]: p["groups"] for p in key_parts}
    for pp in paper_parts:
        part_no = pp["part"]
        kgroups = key_by_part.get(part_no, [])
        for gi, g in enumerate(pp.get("groups") or []):
            kg = kgroups[gi] if gi < len(kgroups) else None
            if not kg:
                continue
            t = g["type"]
            ui_type = f"match-{g.get('view', 'drag')}" if t == "match" else t
            ans_map = kg.get("answers") or {}
            if t == "multi":
                first, last = int(g["first"]), int(g["last"])
                span = max(1, last - first + 1)
                expected_raw = ans_map.get(str(first), [])
                expected_arr = expected_raw if isinstance(expected_raw, list) else [expected_raw]
                expected = sorted({str(x).strip().upper() for x in expected_arr if str(x).strip()})
                picked_raw = answers.get(str(first), [])
                if not isinstance(picked_raw, list):
                    picked_raw = [picked_raw] if picked_raw else []
                picked = sorted({str(x).strip().upper() for x in picked_raw if str(x).strip()})[: len(expected) or span]
                hits = sum(1 for x in picked if x in expected)
                ok = len(expected) > 0 and len(picked) == len(expected) and hits == len(expected)
                raw_total += hits
                max_total += span
                units.append({
                    "part": part_no,
                    "unitKey": f"{first}-{last}" if span > 1 else str(first),
                    "label": f"{first}–{last}" if span > 1 else str(first),
                    "first": first,
                    "count": span,
                    "qtype": "multi",
                    "earned": hits,
                    "max": span,
                    "ok": ok,
                    "userText": ", ".join(picked),
                    "correctText": ", ".join(expected),
                })
                continue
            for n in range(int(g["first"]), int(g["last"]) + 1):
                ns = str(n)
                exp = ans_map.get(ns)
                uval = answers.get(ns)
                if t == "fill":
                    acc = exp if isinstance(exp, list) else ([exp] if exp is not None else [])
                    ok = match_fill(uval, acc)
                    utxt = str(uval or "").strip()
                    ctxt = " / ".join(str(x) for x in acc if x is not None)
                else:
                    raw_exp = exp[0] if isinstance(exp, list) and exp else exp
                    ctxt = norm_token(raw_exp, t)
                    utxt = norm_token(uval, t)
                    ok = bool(utxt and ctxt and utxt == ctxt)
                raw_total += 1 if ok else 0
                max_total += 1
                units.append({
                    "part": part_no,
                    "unitKey": ns,
                    "label": ns,
                    "first": n,
                    "count": 1,
                    "qtype": ui_type,
                    "earned": 1 if ok else 0,
                    "max": 1,
                    "ok": ok,
                    "userText": utxt,
                    "correctText": ctxt,
                })
    return raw_total, max_total, units


def load_legacy_source(path: pathlib.Path) -> tuple[dict[str, tuple[int, dict]], dict[str, tuple[int, object]]]:
    """返回 (attempts_by_id -> (u_ms, dict), kv_by_key -> (u_ms, val))"""
    attempts: dict[str, tuple[int, dict]] = {}
    kv: dict[str, tuple[int, object]] = {}
    if path.suffix.lower() in (".sqlite3", ".db", ".sqlite"):
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            for c, rid, u, d, v in conn.execute("SELECT c, id, u, d, v FROM records WHERE d=0 ORDER BY seq"):
                if not v:
                    continue
                obj = json.loads(v)
                u_ms = int(u or 0)
                if c == "attempts" and isinstance(obj, dict):
                    attempts[rid] = (u_ms, obj)
                elif c == "kv":
                    val = obj.get("v") if isinstance(obj, dict) and "v" in obj else obj
                    kv[rid] = (u_ms, val)
        finally:
            conn.close()
        return attempts, kv

    raw = json.loads(path.read_text("utf-8"))
    if isinstance(raw, dict) and isinstance(raw.get("records"), list):
        for r in raw["records"]:
            if not isinstance(r, dict) or r.get("d"):
                continue
            c, rid, u_ms, obj = r.get("c"), str(r.get("id") or ""), int(r.get("u") or 0), r.get("v")
            if c == "attempts" and isinstance(obj, dict) and rid:
                attempts[rid] = (u_ms, obj)
            elif c == "kv" and rid:
                val = obj.get("v") if isinstance(obj, dict) and "v" in obj else obj
                kv[rid] = (u_ms, val)
    elif isinstance(raw, dict):
        for a in raw.get("attempts") or []:
            if isinstance(a, dict) and a.get("id"):
                attempts[str(a["id"])] = (int(a.get("updatedAt") or a.get("finishedAt") or a.get("startedAt") or 0), a)
        for item in raw.get("kv") or []:
            if isinstance(item, dict) and item.get("k"):
                kv[str(item["k"])] = (int(item.get("updatedAt") or 0), item.get("v"))
    return attempts, kv


def day_str(ms: int) -> str:
    dt = datetime.datetime.fromtimestamp(ms / 1000.0, tz=datetime.timezone(datetime.timedelta(hours=8)))
    return dt.strftime("%Y-%m-%d")


def convert_skill_state(a: dict) -> dict:
    submitted = a.get("status") == "submitted"
    answers = {str(k): v for k, v in (a.get("answers") or {}).items() if v is not None and v != ""}
    essays = {str(k): str(v) for k, v in (a.get("essays") or {}).items() if str(v).strip()}
    flags = {str(k): True for k, v in (a.get("flags") or {}).items() if v}
    raw_hl = a.get("hl") or a.get("highlights") or {}
    highlights = {str(k): [str(x) for x in v if x] for k, v in raw_hl.items() if isinstance(v, list) and v}
    st: dict = {
        "status": "submitted" if submitted else "active",
        "answers": answers,
        "essays": essays,
        "flags": flags,
        "highlights": highlights,
        "elapsed": int(a.get("elapsed") or 0),
        "limit": a.get("limit"),
        "deadlineAt": None,
        "listenDone": bool(a.get("listenDone")),
        "audioPart": int(a.get("part") or 0),
        "audioSec": 0,
        "viewPart": int(a.get("part") or 0),
        "curQ": int(a.get("cur") or 1),
    }
    if submitted:
        st["submittedAt"] = int(a.get("finishedAt") or a.get("updatedAt") or a.get("startedAt") or int(time.time() * 1000))
        if isinstance(a.get("result"), dict):
            st["result"] = a["result"]
    return st


def load_pack_pair(ielts_dir: pathlib.Path, pid: str) -> tuple[dict | None, dict | None]:
    p_file = ielts_dir / "papers" / f"{pid}.json"
    k_file = ielts_dir / "keys" / f"{pid}.json"
    if not p_file.is_file() or not k_file.is_file():
        return None, None
    paper = json.loads(p_file.read_text("utf-8"))
    key = json.loads(k_file.read_text("utf-8"))
    if paper.get("listeningRef") and not paper.get("listening"):
        ref_p = ielts_dir / "papers" / f"{paper['listeningRef']}.json"
        if ref_p.is_file():
            paper["listening"] = json.loads(ref_p.read_text("utf-8")).get("listening")
    if key.get("listeningRef") and not key.get("listening"):
        ref_k = ielts_dir / "keys" / f"{key['listeningRef']}.json"
        if ref_k.is_file():
            key["listening"] = json.loads(ref_k.read_text("utf-8")).get("listening")
    return paper, key


def build_migration_rows(
    attempts: dict[str, tuple[int, dict]],
    kv: dict[str, tuple[int, object]],
    ielts_dir: pathlib.Path,
) -> tuple[list[tuple[str, str, dict, float]], dict[str, tuple[int, int]]]:
    """返回 (rows_to_upsert: [(tbl, k, data_dict, t_sec)], day_deltas: {day: (questions, correct)})"""
    index_titles: dict[str, tuple[str, str, str]] = {}
    idx_path = ielts_dir / "index.json"
    if idx_path.is_file():
        idx_doc = json.loads(idx_path.read_text("utf-8"))
        for e in idx_doc.get("papers") or []:
            fam, book, name, grp = e.get("family", "cam"), e.get("book", ""), str(e.get("name", "")), e.get("group", "")
            if fam == "cam" and book:
                label = f"剑雅 {book} Test {re.sub(r'^Test\\s*', '', name, flags=re.I)}"
            elif fam == "gt" and book:
                label = f"剑雅 {book} G类 {re.sub(r'^Test\\s*', '', name, flags=re.I)}"
            elif fam == "jj" and grp:
                label = f"机经 Pro {grp.replace('机经Pro套题', '').replace('（', '').replace('）', '')} {name}".strip()
            else:
                label = e.get("title") or e["id"]
            index_titles[e["id"]] = (label, e.get("exam") or ("ielts-gt" if fam == "gt" else "ielts-a"), fam)

    out_rows: list[tuple[str, str, dict, float]] = []
    consumed_attempts: set[str] = set()
    graded_events: list[tuple[int, str, str, str, str, dict]] = []  # (at_ms, pid, title, exam, skill, skill_state)

    # 1. 合并整套模考 mock:<id>
    for k, (u_ms, m) in sorted(kv.items()):
        if not k.startswith("mock:") or not isinstance(m, dict):
            continue
        pid = str(m.get("pid") or "")
        if not pid:
            continue
        steps = m.get("steps") if isinstance(m.get("steps"), dict) else {}
        skills = [s for s in (m.get("skills") or ORDER) if s in ORDER]
        if not skills:
            skills = [s for s in ORDER if s in steps]
        if not skills:
            continue
        title, exam, fam = index_titles.get(
            pid,
            (str(m.get("title") or pid), "ielts-gt" if m.get("family") == "gt" else "ielts-a", str(m.get("family") or "cam")),
        )
        sections: dict[str, dict] = {}
        latest_ms = max(u_ms, int(m.get("finishedAt") or m.get("startedAt") or 0))
        for s in skills:
            aid = steps.get(s)
            if aid and aid in attempts:
                consumed_attempts.add(aid)
                au_ms, a_obj = attempts[aid]
                latest_ms = max(latest_ms, au_ms, int(a_obj.get("updatedAt") or a_obj.get("finishedAt") or 0))
                sections[s] = convert_skill_state(a_obj)
                if sections[s]["status"] == "submitted":
                    graded_events.append((sections[s]["submittedAt"], pid, title, exam, s, sections[s]))
            else:
                sections[s] = {
                    "status": "intro",
                    "answers": {},
                    "essays": {},
                    "flags": {},
                    "highlights": {},
                    "elapsed": 0,
                    "limit": 3600 if s in ("reading", "writing") else None,
                    "deadlineAt": None,
                    "listenDone": False,
                    "audioPart": 0,
                    "audioSec": 0,
                    "viewPart": 0,
                    "curQ": 1,
                }
        unsubmitted = [s for s in skills if sections[s]["status"] != "submitted"]
        all_done = len(unsubmitted) == 0
        run_id = f"legacy_mock_{m.get('id') or k.split(':', 1)[1]}"
        row: dict = {
            "id": run_id,
            "paperId": pid,
            "paperTitle": title,
            "family": fam,
            "exam": exam,
            "scope": "full",
            "mode": "mock",
            "assisted": False,
            "assistSnapshot": {"practiceLookup": False, "practiceVocabMarks": False},
            "skills": skills,
            "currentSkill": unsubmitted[0] if unsubmitted else skills[-1],
            "sections": sections,
            "startedAt": int(m.get("startedAt") or latest_ms or int(time.time() * 1000)),
            "updatedAt": int(latest_ms or time.time() * 1000),
        }
        if all_done:
            sub_at = int(m.get("finishedAt") or max((sections[s].get("submittedAt", 0) for s in skills), default=row["updatedAt"]))
            row["submittedAt"] = sub_at
            bands = [
                sections[s]["result"]["band"]
                for s in skills
                if isinstance(sections[s].get("result"), dict) and isinstance(sections[s]["result"].get("band"), (int, float))
            ]
            row["overallBand"] = (round_band(sum(bands) / len(bands)) if len(bands) > 1 else float(bands[0])) if bands else None
        t_sec = row["updatedAt"] / 1000.0 if row["updatedAt"] > 1e11 else float(row["updatedAt"] or time.time())
        out_rows.append(("ieltsAttempts", run_id, row, t_sec))

    # 2. 独立单科记录
    for aid, (u_ms, a) in sorted(attempts.items()):
        if aid in consumed_attempts:
            continue
        pid = str(a.get("pid") or "")
        skill = str(a.get("skill") or "")
        if not pid or skill not in ORDER:
            continue
        title, exam, fam = index_titles.get(
            pid,
            (
                str(a.get("title") or pid),
                "ielts-gt" if a.get("family") == "gt" else "ielts-a",
                "wj" if pid.startswith("wj:") else str(a.get("family") or "cam"),
            ),
        )
        mode = "mock" if a.get("mode") == "exam" else "practice"
        st = convert_skill_state(a)
        updated_ms = max(u_ms, int(a.get("updatedAt") or a.get("finishedAt") or a.get("startedAt") or int(time.time() * 1000)))
        run_id = f"legacy_{aid}"
        row = {
            "id": run_id,
            "paperId": pid,
            "paperTitle": title,
            "family": fam,
            "exam": exam,
            "scope": skill,
            "mode": mode,
            "assisted": False,
            "assistSnapshot": {"practiceLookup": False, "practiceVocabMarks": False},
            "skills": [skill],
            "currentSkill": skill,
            "sections": {skill: st},
            "startedAt": int(a.get("startedAt") or updated_ms),
            "updatedAt": updated_ms,
        }
        if st["status"] == "submitted":
            row["submittedAt"] = st["submittedAt"]
            b = st.get("result", {}).get("band") if isinstance(st.get("result"), dict) else None
            row["overallBand"] = float(b) if isinstance(b, (int, float)) else None
            graded_events.append((st["submittedAt"], pid, title, exam, skill, st))
        t_sec = updated_ms / 1000.0 if updated_ms > 1e11 else float(updated_ms or time.time())
        out_rows.append(("ieltsAttempts", run_id, row, t_sec))

    # 3. 错题本回填与每日做题统计
    mastery_map: dict[str, dict] = {}
    day_deltas: dict[str, tuple[int, int]] = {}
    pack_cache: dict[str, tuple[dict | None, dict | None]] = {}

    for at_ms, pid, title, exam, skill, st in sorted(graded_events, key=lambda x: x[0]):
        if skill not in ("listening", "reading"):
            continue
        if pid not in pack_cache:
            pack_cache[pid] = load_pack_pair(ielts_dir, pid)
        paper_doc, key_doc = pack_cache[pid]
        if paper_doc and key_doc and paper_doc.get(skill) and key_doc.get(skill):
            raw_sc, max_sc, units = grade_paper_section(paper_doc[skill], key_doc[skill], st["answers"])
            # 若旧记录缺少 result，顺便补齐
            if not isinstance(st.get("result"), dict):
                st["result"] = {
                    "raw": raw_sc,
                    "total": max_sc,
                    "band": calc_band(skill, raw_sc, max_sc, exam == "ielts-gt"),
                    "reason": "manual",
                    "elapsed": st["elapsed"],
                }
            dkey = day_str(at_ms)
            oq, oc = day_deltas.get(dkey, (0, 0))
            day_deltas[dkey] = (oq + max_sc, oc + raw_sc)
            for u in units:
                mid = f"{pid}:{skill}:{u['unitKey']}"
                mrow = mastery_map.get(mid)
                if not mrow:
                    if u["ok"]:
                        continue
                    mrow = {
                        "id": mid,
                        "paperId": pid,
                        "paperTitle": title,
                        "exam": exam,
                        "skill": skill,
                        "part": u["part"],
                        "unitKey": u["unitKey"],
                        "label": u["label"],
                        "first": u["first"],
                        "count": u["count"],
                        "qtype": u["qtype"],
                        "correctText": u["correctText"],
                        "firstWrongAt": at_ms,
                        "updatedAt": at_ms,
                        "history": [],
                    }
                    mastery_map[mid] = mrow
                mrow["updatedAt"] = at_ms
                mrow["correctText"] = u["correctText"]
                mrow["history"].append({
                    "at": at_ms,
                    "earned": u["earned"],
                    "max": u["max"],
                    "right": u["ok"],
                    "userText": u["userText"],
                    "mode": "mock",
                })
                if not u["ok"]:
                    mrow.pop("retiredAt", None)
                elif len(mrow["history"]) >= 2 and mrow["history"][-1]["right"] and mrow["history"][-2]["right"]:
                    mrow.setdefault("retiredAt", at_ms)
        elif isinstance(st.get("result"), dict) and st["result"].get("total"):
            dkey = day_str(at_ms)
            oq, oc = day_deltas.get(dkey, (0, 0))
            day_deltas[dkey] = (oq + int(st["result"]["total"]), oc + int(st["result"].get("raw") or 0))

    for mid, mrow in sorted(mastery_map.items()):
        t_sec = mrow["updatedAt"] / 1000.0 if mrow["updatedAt"] > 1e11 else float(mrow["updatedAt"] or time.time())
        out_rows.append(("ieltsMastery", mid, mrow, t_sec))

    # 4. 口语练习进度与收藏 kv["speaking:progress"]
    if "speaking:progress" in kv:
        sp_u_ms, sp_val = kv["speaking:progress"]
        if isinstance(sp_val, dict):
            for qid, cur in sorted(sp_val.items()):
                if not isinstance(cur, dict):
                    continue
                if not cur.get("done") and not cur.get("fav") and not cur.get("count"):
                    continue
                last_ms = int(cur.get("lastAt") or sp_u_ms or int(time.time() * 1000))
                srow: dict = {"id": str(qid), "updatedAt": last_ms}
                if cur.get("done"):
                    srow["done"] = True
                if cur.get("fav"):
                    srow["fav"] = True
                if cur.get("count"):
                    srow["count"] = int(cur["count"])
                if cur.get("lastAt"):
                    srow["lastAt"] = int(cur["lastAt"])
                t_sec = last_ms / 1000.0 if last_ms > 1e11 else float(last_ms or time.time())
                out_rows.append(("ieltsSpeaking", str(qid), srow, t_sec))

    return out_rows, day_deltas


def apply_to_yingyu_db(
    db_path: pathlib.Path,
    user_name: str | None,
    uid_arg: int | None,
    create_pw: str | None,
    rows: list[tuple[str, str, dict, float]],
    day_deltas: dict[str, tuple[int, int]],
    source_tag: str,
) -> dict[str, int]:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    srv.DB_PATH = str(db_path)
    with contextlib.closing(srv.sdb()) as c, c:
        c.execute("BEGIN IMMEDIATE")
        if uid_arg is not None:
            urow = c.execute("SELECT id, name, seq FROM users WHERE id=?", (uid_arg,)).fetchone()
            if not urow:
                raise SystemExit(f"找不到 uid={uid_arg} 的账户")
            uid, uname, seq = urow
        else:
            assert user_name
            urow = c.execute("SELECT id, name, seq FROM users WHERE name=?", (user_name,)).fetchone()
            if not urow:
                if not create_pw:
                    raise SystemExit(f"用户 {user_name!r} 不存在（可传 --create-password 自动创建）")
                uid = c.execute(
                    "INSERT INTO users (name, pw, created, seq) VALUES (?,?,?,0)",
                    (user_name, srv.hash_pw(create_pw), time.time()),
                ).lastrowid
                uname, seq = user_name, 0
            else:
                uid, uname, seq = urow

        written = 0
        skipped = 0
        for tbl, k, obj, t_sec in rows:
            raw = json.dumps(obj, ensure_ascii=False)
            old = c.execute("SELECT data, t FROM rows WHERE uid=? AND tbl=? AND k=?", (uid, tbl, k)).fetchone()
            if old and (old[0] == raw or float(old[1]) > t_sec):
                skipped += 1
                continue
            seq += 1
            c.execute("INSERT OR REPLACE INTO rows VALUES (?,?,?,?,?,?)", (uid, tbl, k, raw, t_sec, seq))
            written += 1

        # 幂等合并每日做题量：用 kv 里的迁移标记防止重复叠加到 days 表
        marker_key = f"ielts-migrated-days:{source_tag}"
        already_days = c.execute(
            "SELECT 1 FROM rows WHERE uid=? AND tbl='kv' AND k=?", (uid, marker_key)
        ).fetchone()
        days_written = 0
        if not already_days and day_deltas:
            for dkey, (dq, dc) in sorted(day_deltas.items()):
                old_day = c.execute("SELECT data, t FROM rows WHERE uid=? AND tbl='days' AND k=?", (uid, dkey)).fetchone()
                if old_day and old_day[0]:
                    base = json.loads(old_day[0]) or {}
                else:
                    base = {"day": dkey, "newWords": 0, "reviews": 0, "questions": 0, "correct": 0, "lookups": 0}
                base["questions"] = int(base.get("questions") or 0) + dq
                base["correct"] = int(base.get("correct") or 0) + dc
                seq += 1
                c.execute(
                    "INSERT OR REPLACE INTO rows VALUES (?,?,?,?,?,?)",
                    (uid, "days", dkey, json.dumps(base, ensure_ascii=False), time.time(), seq),
                )
                days_written += 1
            seq += 1
            c.execute(
                "INSERT OR REPLACE INTO rows VALUES (?,?,?,?,?,?)",
                (uid, "kv", marker_key, json.dumps({"key": marker_key, "value": int(time.time() * 1000)}), time.time(), seq),
            )

        c.execute("UPDATE users SET seq=? WHERE id=?", (seq, uid))
    return {"uid": uid, "written": written, "skipped": skipped, "days_written": days_written, "seq": seq}


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="迁移旧版独立雅思站点数据到英语之道 yingyu.db")
    p.add_argument("--source", type=pathlib.Path, required=True, help="旧版 sync.sqlite3 或导出 JSON 路径")
    p.add_argument("--db", type=pathlib.Path, default=pathlib.Path(srv.DB_PATH), help="目标 yingyu.db 路径")
    grp = p.add_mutually_exclusive_group(required=True)
    grp.add_argument("--user", help="目标账户用户名")
    grp.add_argument("--uid", type=int, help="目标账户 uid")
    p.add_argument("--create-password", help="当目标用户名不存在时自动创建该账户所用的密码")
    p.add_argument("--ielts-dir", type=pathlib.Path, default=ROOT / "public" / "ielts", help="public/ielts 目录路径")
    p.add_argument("--dry-run", action="store_true", help="仅预览转换条数，不写入数据库")
    args = p.parse_args(argv)

    if not args.source.is_file():
        p.error(f"找不到源文件：{args.source}")

    attempts, kv = load_legacy_source(args.source)
    rows, day_deltas = build_migration_rows(attempts, kv, args.ielts_dir)
    by_tbl: dict[str, int] = {}
    for tbl, _, _, _ in rows:
        by_tbl[tbl] = by_tbl.get(tbl, 0) + 1

    print(f"解析完成：{len(attempts)} 条旧单科记录，{len(kv)} 条旧 KV")
    print(f"生成记录：{by_tbl}，涉及打卡日期 {len(day_deltas)} 天")
    if args.dry_run:
        return

    tag = f"{args.source.name}:{len(attempts)}:{len(kv)}"
    res = apply_to_yingyu_db(args.db, args.user, args.uid, args.create_password, rows, day_deltas, tag)
    print(f"写入完成：uid={res['uid']}，新增/更新 {res['written']} 条，幂等跳过 {res['skipped']} 条，打卡合并 {res['days_written']} 天，当前 seq={res['seq']}")


if __name__ == "__main__":
    main()
