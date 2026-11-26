#!/usr/bin/env python3
"""Build the unified IELTS static data pack for CETPath.

Inputs:
  ../../question-bank/data      (index.json, papers/*.json, writing-jj.json, oral.json)
  ../../speaking-site/public    (data.json, audio/**)
  ../public/dict                (shards/*.json, meta.json -> adds books/ielts.json)

Outputs under ../public/:
  ielts/index.json              catalogue + fullMock/skill capability metadata
  ielts/papers/<id>.json        pure exam payload (NO answers, NO transcripts, NO explanations, NO model essays)
  ielts/keys/<id>.json          lightweight grading keys (cached for offline grading, never mounted in exam DOM)
  ielts/explain/<id>.json       post-submit review pack (transcripts, explanations, passage source quotes, model essays)
  ielts/writing-jj.json         242 writing prompts (pure prompt)
  ielts/writing-jj-explain.json model essays for the 242 writing prompts
  ielts/speaking.json           100 speaking topics (658 Part 1/2/3 questions)
  ielts/img/<hash>.<ext>        locally mirrored maps, diagrams, flowcharts, and Writing Task 1 charts
  audio/speaking/**             copied/hardlinked speaking examiner & model recordings
  dict/books/ielts.json         IELTS core vocabulary book extracted from ECDICT shards
"""
from __future__ import annotations

import concurrent.futures
import glob
import hashlib
import html as htmlmod
import json
import os
import re
import shutil
import sys
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
WORKSPACE = ROOT.parent
BANK = WORKSPACE / "question-bank" / "data"
SPEAKING_SITE = WORKSPACE / "speaking-site" / "public"
PUB = ROOT / "public"
OUT = PUB / "ielts"
IMG_DIR = OUT / "img"

ALLOWED = {
    "p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li",
    "table", "thead", "tbody", "tr", "td", "th", "sup", "sub",
    "div", "h1", "h2", "h3", "h4", "img",
}
VOID = {"br", "img"}
BLANK_RE = re.compile(r"(?:\.{4,}|…+)")
BLOCK_OPEN = re.compile(r"<(?:p|li|td|div)>")
LEAD_NUM = re.compile(r"\s*(?:<(?:strong|b)>)?\s*(\d{1,2})\s*[.)]?\s*(?:</(?:strong|b)>)?\s*")
LRC = re.compile(r"^\[(\d+):(\d+)[.:](\d+)\](.*?)(?:##.*)?$")
IMG_SRC_RE = re.compile(r'(<img\b[^>]*?\bsrc=")([^"]+)(")', re.I)


class Clean(HTMLParser):
    """Whitelist HTML sanitizer preserving table spans and image sources."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.stack: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag not in ALLOWED:
            return
        a = dict(attrs)
        parts = [tag]
        if tag in ("td", "th"):
            for k in ("colspan", "rowspan"):
                val = a.get(k) or ""
                if val.isdigit():
                    parts.append(f'{k}="{val}"')
        if tag == "img":
            src = (a.get("src") or "").strip()
            if not src.startswith(("http://", "https://", "/")):
                return
            parts.append(f'src="{htmlmod.escape(src, quote=True)}"')
        self.out.append("<" + " ".join(parts) + ">")
        if tag not in VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag not in ALLOWED or tag in VOID or tag not in self.stack:
            return
        while self.stack:
            t = self.stack.pop()
            self.out.append(f"</{t}>")
            if t == tag:
                break

    def handle_data(self, data: str) -> None:
        self.out.append(htmlmod.escape(data, quote=False))

    def result(self) -> str:
        while self.stack:
            self.out.append(f"</{self.stack.pop()}>")
        return "".join(self.out)


def clean_html(raw: str | None) -> str:
    if not raw:
        return ""
    p = Clean()
    p.feed(raw)
    p.close()
    h = p.result()
    h = re.sub(r"<(p|div|li)>(?:\s|<br>)*</\1>", "", h)
    h = re.sub(r"(?:<br>\s*){3,}", "<br><br>", h)
    h = re.sub(r"[ \t\r\n]+", " ", h)
    return h.strip()


def plain(h: str | None) -> str:
    return htmlmod.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h or ""))).strip()


# ---------- Image mirroring ----------
def img_local_name(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    ext = os.path.splitext(parsed.path)[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"):
        ext = ".png"
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]
    return f"{digest}{ext}"


def mirror_images(urls: set[str]) -> dict[str, str]:
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    mapping: dict[str, str] = {}
    todo: list[tuple[str, Path]] = []
    for url in sorted(urls):
        if not url.startswith(("http://", "https://")):
            mapping[url] = url
            continue
        fname = img_local_name(url)
        dst = IMG_DIR / fname
        mapping[url] = f"/ielts/img/{fname}"
        if not (dst.is_file() and dst.stat().st_size > 0):
            todo.append((url, dst))

    failed: list[tuple[str, str]] = []

    def fetch_one(item: tuple[str, Path]) -> None:
        import time as _time
        url, dst = item
        last_err = ""
        for attempt in range(3):
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": ""})
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = resp.read()
                if not data:
                    raise ValueError("empty image body")
                tmp = dst.with_suffix(dst.suffix + ".tmp")
                tmp.write_bytes(data)
                tmp.replace(dst)
                return
            except Exception as exc:  # noqa: BLE001
                last_err = str(exc)
                _time.sleep(0.6 * (attempt + 1))
        failed.append((url, last_err))
        mapping[url] = url  # keep remote fallback if offline

    if todo:
        print(f"Downloading {len(todo)} IELTS question/chart images...")
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(fetch_one, todo))
    if failed:
        print(f"WARNING: {len(failed)} image(s) kept remote URL due to download error:", failed[:3], file=sys.stderr)
    return mapping


def rewrite_html_imgs(html_str: str, img_map: dict[str, str]) -> str:
    if not html_str or "<img" not in html_str:
        return html_str

    def repl(m: re.Match[str]) -> str:
        raw_url = htmlmod.unescape(m.group(2))
        mapped = img_map.get(raw_url, m.group(2))
        return f'{m.group(1)}{htmlmod.escape(mapped, quote=True)}{m.group(3)}'

    return IMG_SRC_RE.sub(repl, html_str)


# ---------- Parsing & slot placement ----------
def parse_fill(v: object) -> dict:
    s = str(v).strip()
    k = 1 + max(a.count("|") for a in s.split("/"))
    if k == 1:
        return {"k": 1, "mode": "per", "per": [[a.strip() for a in s.split("/") if a.strip()]]}
    parts = s.split("|")
    if len(parts) == k:
        return {"k": k, "mode": "per", "per": [[x.strip() for x in p.split("/") if x.strip()] for p in parts]}
    tuples = [[x.strip() for x in a.split("|")] for a in s.split("/")]
    return {"k": k, "mode": "tuple", "tuples": [t for t in tuples if len(t) == k]}


def strip_number(pre: str, n: int) -> str:
    return re.sub(r"(?:<(?:strong|b)>)?\s*%d\s*[.)]?\s*(?:</(?:strong|b)>)?\s*$" % n, "", pre)


def place_blanks(body: str, slots: list[tuple[int, int]], ctx: str) -> str:
    found = list(BLANK_RE.finditer(body))
    if len(found) != len(slots):
        raise ValueError(f"{ctx}: {len(found)} blanks vs {len(slots)} answer slots")
    out: list[str] = []
    pos = 0
    for m, (qn, j) in zip(found, slots):
        pre = body[pos:m.start()]
        if j == 0:
            pre = strip_number(pre, qn)
        out += [pre, f'<span class="blank" data-q="{qn}" data-i="{j}"></span>']
        pos = m.end()
    out.append(body[pos:])
    res = "".join(out)
    for qn in sorted({q for q, _ in slots}):
        at = res.find(f'data-q="{qn}"')
        if at < 0:
            continue
        starts = list(BLOCK_OPEN.finditer(res, 0, at))
        if not starts:
            continue
        b = starts[-1]
        lead = LEAD_NUM.match(res, b.end())
        if lead and int(lead.group(1)) == qn:
            res = res[:b.end()] + res[lead.end():]
    return res


def extract_table_rows(raw_qc: str, first: int, last: int) -> list[dict]:
    """Extract clean row labels for matrix radio-grid matching questions."""
    text = htmlmod.unescape(re.sub(r"<[^>]+>", "\n", raw_qc or ""))
    chunks = BLANK_RE.split(text)
    cnt = last - first + 1
    rows: list[dict] = []
    if len(chunks) - 1 == cnt:
        for i in range(cnt):
            qn = first + i
            seg = re.sub(r"\s+", " ", chunks[i]).strip()
            # Take text starting from the question number if present
            m = re.search(rf"(?:^|\s){qn}\s*[.)]?\s*(.+)$", seg)
            label = m.group(1).strip() if m else re.sub(rf"^{qn}\s*[.)]?\s*", "", seg).strip()
            rows.append({"n": qn, "text": label or f"Question {qn}"})
    else:
        for qn in range(first, last + 1):
            rows.append({"n": qn, "text": f"Question {qn}"})
    return rows


def try_inject_heading_slots(passage_html: str, raw_qc: str, first: int, last: int) -> tuple[str, list[dict]] | None:
    """If this is a List of Headings group and every target Paragraph/Section A..Z is uniquely
    located in `passage_html`, inject `<span class="heading-slot" data-q="N" data-para="A"></span>`
    at the start of each matched paragraph block and return `(updated_html, rows)`.
    """
    cnt = last - first + 1
    clean_qc = plain(raw_qc)
    # Match pairs like "14 Paragraph A" or "28 Section B" (ignoring "Example Paragraph A ...")
    pairs = [(int(n), p.upper()) for n, p in re.findall(r"\b(\d{1,2})\s*[.)]?\s*(?:Paragraph|Section)\s+([A-Z])\b", clean_qc, re.I)]
    pairs = [(n, p) for n, p in pairs if first <= n <= last]
    if len(pairs) != cnt or [n for n, _ in pairs] != list(range(first, last + 1)):
        return None

    updated = passage_html
    rows: list[dict] = []
    for qn, para_letter in pairs:
        # Match block opening followed by standalone paragraph letter A / Paragraph A / Section A
        pat = re.compile(
            rf"(<(?:p|div|h[1-4])>)\s*((?:<(?:strong|b|em)>)*\s*(?:(?:Paragraph|Section)\s+)?{para_letter}(?:[.)]?(?:\s|</(?:strong|b|em)>)))",
            re.I,
        )
        matches = list(pat.finditer(updated))
        if len(matches) != 1:
            return None
        m = matches[0]
        slot_html = f'{m.group(1)}<span class="heading-slot" data-q="{qn}" data-para="{para_letter}"></span>{m.group(2)}'
        updated = updated[:m.start()] + slot_html + updated[m.end():]
        rows.append({"n": qn, "para": para_letter, "text": f"Paragraph {para_letter}"})
    return updated, rows


def highlights(a: dict) -> list[str]:
    out: list[str] = []
    for d in ((a.get("articleSourceHighlight") or {}).get("data") or []):
        for v in d.values():
            t = (v or {}).get("text")
            if t and t.strip():
                out.append(t.strip())
    return out


def transcript(s: dict) -> list[dict]:
    out: list[dict] = []
    for it in ((s.get("subjectData") or {}).get("listenDetailList") or []):
        t = (it.get("englishDetail") or "").strip()
        if t:
            out.append({"s": int(it.get("startTime") or 0), "t": t})
    if out:
        return out
    for line in (s.get("listenDetail") or "").splitlines():
        m = LRC.match(line.strip())
        if m and m.group(4).strip():
            mm, ss, cs, t = m.groups()
            out.append({"s": (int(mm) * 60 + int(ss)) * 1000 + int(cs.ljust(3, "0")[:3]), "t": t.strip()})
    return out


def build_group(
    q: dict,
    sec_name: str,
    passage_html: str | None,
    img_map: dict[str, str],
    ctx: str,
) -> tuple[dict, dict, dict, dict, str | None]:
    """Returns (paper_group, key_group, explain_map, source_map, updated_passage_html)."""
    qj = q["questionJson"]
    t = str(qj.get("questionType"))
    first, last = int(qj["startIndex"]), int(qj["endIndex"])
    ans = q.get("answerJson") or []
    g_type = {"0": "fill", "1": "single", "2": "multi", "3": "tfng", "4": "match"}[t]

    instr = rewrite_html_imgs(clean_html(qj.get("descriptions")), img_map)
    pg: dict = {"type": g_type, "first": first, "last": last, "instr": instr}
    kg: dict = {"type": g_type, "first": first, "last": last, "answers": {}}
    ex_map: dict[str, str] = {}
    src_map: dict[str, list[str]] = {}

    q_img = (qj.get("questionsImgSrc") or "").strip()
    o_img = (qj.get("optionsImgSrc") or "").strip()
    if q_img:
        pg["questionsImg"] = img_map.get(q_img, q_img)
    if o_img:
        pg["optionsImg"] = img_map.get(o_img, o_img)

    def collect_note(n: int, a: dict) -> None:
        if a.get("explain"):
            ex_map[str(n)] = a["explain"].strip()
        hl = highlights(a)
        if hl:
            src_map[str(n)] = hl

    if t == "0":
        parsed = [parse_fill(a.get("correctValue")) for a in ans]
        slots: list[tuple[int, int]] = []
        blanks: dict[str, int] = {}
        for i, p in enumerate(parsed):
            qn = first + i
            blanks[str(qn)] = p["k"]
            slots += [(qn, j) for j in range(p["k"])]
            kg["answers"][str(qn)] = p
            collect_note(qn, ans[i])
        body_clean = rewrite_html_imgs(clean_html(qj.get("questionsContent")), img_map)
        pg["body"] = place_blanks(body_clean, slots, ctx)
        pg["blanks"] = blanks

    elif t == "4":
        opts = qj.get("matchOptions") or []
        pg["options"] = [{"k": str(o.get("index") or ""), "t": rewrite_html_imgs(clean_html(o.get("content") or ""), img_map)} for o in opts]
        pg["optionsTitle"] = (qj.get("optionsTitle") or "").strip()
        raw_vm = (qj.get("viewMode") or "").strip().lower()
        raw_desc = plain(qj.get("descriptions"))
        raw_qc = qj.get("questionsContent") or ""
        is_headings_prompt = sec_name == "reading" and bool(re.search(r"list of headings|correct heading", raw_desc, re.I))
        reuse = raw_vm == "table" or bool(re.search(r"more than once", raw_desc, re.I))

        slots = [(first + i, 0) for i in range(len(ans))]
        body_clean = rewrite_html_imgs(clean_html(raw_qc), img_map)
        pg["body"] = place_blanks(body_clean, slots, ctx)

        if is_headings_prompt and passage_html:
            injected = try_inject_heading_slots(passage_html, raw_qc, first, last)
            if injected is not None:
                passage_html, h_rows = injected
                pg["view"] = "headings"
                pg["rows"] = h_rows
                pg["reuse"] = reuse
            else:
                pg["view"] = "drag"
                pg["reuse"] = reuse
        elif raw_vm == "table":
            pg["view"] = "table"
            pg["rows"] = extract_table_rows(raw_qc, first, last)
            pg["reuse"] = True
        else:
            pg["view"] = "drag"
            pg["reuse"] = reuse

        for i, a in enumerate(ans):
            idx = int(a["correctValue"])
            if not (0 <= idx < len(pg["options"])):
                raise ValueError(f"{ctx}: answer index {idx} out of range for {len(pg['options'])} options")
            kg["answers"][str(first + i)] = {"i": idx}
            collect_note(first + i, a)

    elif t in ("1", "3"):
        qs = qj["questions"]
        pg["items"] = []
        for i, it in enumerate(qs):
            opts = [rewrite_html_imgs(clean_html(o.get("content") or ""), img_map) for o in it.get("options") or []]
            idx = int(ans[i]["correctValue"])
            if not (0 <= idx < len(opts)):
                raise ValueError(f"{ctx}: choice answer {idx} out of range")
            pg["items"].append({
                "n": first + i,
                "text": rewrite_html_imgs(clean_html(it.get("content")), img_map),
                "options": opts,
            })
            kg["answers"][str(first + i)] = {"i": idx}
            collect_note(first + i, ans[i])

    elif t == "2":
        n = first
        pg["items"] = []
        for i, it in enumerate(qj["questions"]):
            cnt = int(it["number"])
            opts = [rewrite_html_imgs(clean_html(o.get("content") or ""), img_map) for o in it.get("options") or []]
            correct_set = sorted(int(x) for x in ans[i]["correctValue"])
            if len(correct_set) != cnt or any(x < 0 or x >= len(opts) for x in correct_set):
                raise ValueError(f"{ctx}: invalid multi-select answer {correct_set} for count {cnt}")
            pg["items"].append({
                "n": n,
                "count": cnt,
                "text": rewrite_html_imgs(clean_html(it.get("content")), img_map),
                "options": opts,
            })
            kg["answers"][str(n)] = {"set": correct_set, "first": n, "count": cnt}
            collect_note(n, ans[i])
            n += cnt

    return pg, kg, ex_map, src_map, passage_html


def collect_all_image_urls(idx: dict, wj_raw: list[dict]) -> set[str]:
    urls: set[str] = set()

    def scan_html(raw: str | None) -> None:
        if not raw:
            return
        cleaned = clean_html(raw)
        for m in IMG_SRC_RE.finditer(cleaned):
            u = htmlmod.unescape(m.group(2)).strip()
            if u.startswith(("http://", "https://")):
                urls.add(u)

    for e in idx["papers"]:
        src = json.loads((BANK / "papers" / f"{e['id']}.json").read_text(encoding="utf-8"))
        for sec in ("listening", "reading"):
            for part in src.get(sec) or []:
                scan_html(part.get("passagesContent"))
                for q in part.get("questions") or []:
                    qj = q["questionJson"]
                    for k in ("optionsImgSrc", "questionsImgSrc"):
                        u = (qj.get(k) or "").strip()
                        if u.startswith(("http://", "https://")):
                            urls.add(u)
                    scan_html(qj.get("descriptions"))
                    scan_html(qj.get("questionsContent"))
                    for it in qj.get("questions") or []:
                        scan_html(it.get("content"))
                        for o in it.get("options") or []:
                            scan_html(o.get("content"))
                    for o in qj.get("matchOptions") or []:
                        scan_html(o.get("content"))
        for w in src.get("writing") or []:
            scan_html(w.get("questionHtml") or w.get("writingQuestionText"))
            scan_html(w.get("sample"))

    for it in wj_raw:
        scan_html(it.get("questionHtml") or it.get("question"))
        scan_html(it.get("sample"))

    return urls


def build_paper_packs(src: dict, img_map: dict[str, str]) -> tuple[dict, dict, dict]:
    pid = src["id"]
    exam = "ielts-gt" if src["family"] == "gt" else "ielts-a"
    paper_doc: dict = {"id": pid, "family": src["family"], "exam": exam, "title": src["title"]}
    key_doc: dict = {"id": pid, "version": 1}
    explain_doc: dict = {"id": pid}

    for meta_k in ("hit", "listeningRef"):
        if src.get(meta_k):
            paper_doc[meta_k] = src[meta_k]
            if meta_k == "listeningRef":
                key_doc[meta_k] = src[meta_k]
                explain_doc[meta_k] = src[meta_k]

    if src.get("listening"):
        paper_doc["listening"] = []
        key_doc["listening"] = []
        explain_doc["listening"] = []
        for s in src["listening"]:
            p_groups, k_groups = [], []
            part_ex: dict[str, str] = {}
            part_src: dict[str, list[str]] = {}
            ordered_qs = sorted(s["questions"], key=lambda x: int(x["questionJson"]["startIndex"]))
            for q in ordered_qs:
                pg, kg, ex_m, src_m, _ = build_group(
                    q, "listening", None, img_map, f"{pid} L{s['part']} Q{q['questionJson'].get('startIndex')}"
                )
                p_groups.append(pg)
                k_groups.append(kg)
                part_ex.update(ex_m)
                part_src.update(src_m)
            paper_doc["listening"].append({
                "part": s["part"],
                "title": f"Listening Part {s['part']}",
                "audioUrl": s["audioUrl"],
                "seconds": s.get("seconds"),
                "groups": p_groups,
            })
            key_doc["listening"].append({"part": s["part"], "groups": k_groups})
            explain_doc["listening"].append({
                "part": s["part"],
                "transcript": transcript(s),
                "explain": part_ex,
                "source": part_src,
            })

    if src.get("reading"):
        paper_doc["reading"] = []
        key_doc["reading"] = []
        explain_doc["reading"] = []
        for s in src["reading"]:
            p_html = rewrite_html_imgs(clean_html(s.get("passagesContent")), img_map)
            p_groups, k_groups = [], []
            part_ex = {}
            part_src = {}
            ordered_qs = sorted(s["questions"], key=lambda x: int(x["questionJson"]["startIndex"]))
            for q in ordered_qs:
                pg, kg, ex_m, src_m, p_html_out = build_group(
                    q, "reading", p_html, img_map, f"{pid} R{s['part']} Q{q['questionJson'].get('startIndex')}"
                )
                p_html = p_html_out or p_html
                p_groups.append(pg)
                k_groups.append(kg)
                part_ex.update(ex_m)
                part_src.update(src_m)
            paper_doc["reading"].append({
                "part": s["part"],
                "title": f"Reading Passage {s['part']}",
                "html": p_html,
                "groups": p_groups,
            })
            key_doc["reading"].append({"part": s["part"], "groups": k_groups})
            explain_doc["reading"].append({
                "part": s["part"],
                "explain": part_ex,
                "source": part_src,
            })

    if src.get("writing"):
        paper_doc["writing"] = []
        explain_doc["writing"] = []
        for w in src["writing"]:
            w_part = int(w["writingPart"])
            paper_doc["writing"].append({
                "part": w_part,
                "title": f"Writing Task {w_part}",
                "html": rewrite_html_imgs(clean_html(w.get("questionHtml") or w.get("writingQuestionText")), img_map),
            })
            explain_doc["writing"].append({
                "part": w_part,
                "sample": rewrite_html_imgs(clean_html(w.get("sample")), img_map),
            })

    return paper_doc, key_doc, explain_doc


def count_q(paper_doc: dict, sec: str) -> int:
    return sum(g["last"] - g["first"] + 1 for s in paper_doc.get(sec) or [] for g in s["groups"])


def build_speaking(oral: dict) -> dict:
    local_data = json.loads((SPEAKING_SITE / "data.json").read_text(encoding="utf-8"))
    local_by_id = {q["id"]: q for q in local_data["questions"]}

    # Copy or hardlink speaking audio into public/audio/speaking/
    src_audio_root = SPEAKING_SITE / "audio"
    dst_audio_root = PUB / "audio" / "speaking"
    copied = skipped = 0
    for dp, _, files in os.walk(src_audio_root):
        for fname in files:
            s_file = Path(dp) / fname
            rel = s_file.relative_to(src_audio_root)
            d_file = dst_audio_root / rel
            if d_file.exists() and d_file.stat().st_size == s_file.stat().st_size:
                skipped += 1
                continue
            d_file.parent.mkdir(parents=True, exist_ok=True)
            try:
                if d_file.exists():
                    d_file.unlink()
                os.link(s_file, d_file)
            except OSError:
                shutil.copy2(s_file, d_file)
            copied += 1

    def map_local_audio(src_rel: str) -> str:
        # e.g. "audio/original/..." -> "/audio/speaking/original/..."
        if src_rel.startswith("audio/"):
            return "/audio/speaking/" + src_rel[len("audio/"):]
        if src_rel.startswith("/audio/"):
            return "/audio/speaking/" + src_rel[len("/audio/"):]
        return src_rel

    def norm_accent(label: str) -> str:
        return label.split("·")[0].strip() or label

    topics = []
    used: set[str] = set()
    counts = {1: 0, 2: 0, 3: 0}
    for t in oral["topics"]:
        qs = []
        for q in t["questions"]:
            item: dict = {"id": q["id"], "part": q["part"], "question": q["question"]}
            lq = local_by_id.get(q["id"])
            if lq:
                used.add(q["id"])
                item["hint"] = lq["hint"]
                item["answer"] = lq["answer"]
                item["examiner"] = [{"accent": norm_accent(a["label"]), "src": map_local_audio(a["src"])} for a in lq["audios"]]
                item["model"] = map_local_audio(lq["answerAudio"])
            else:
                if q["part"] != 3:
                    raise ValueError(f"Speaking Part {q['part']} question {q['id']} missing local answer")
                item["examiner"] = [{"accent": a["accent"], "src": a["url"]} for a in q.get("audio") or []]
            for p in [a["src"] for a in item["examiner"]] + ([item["model"]] if item.get("model") else []):
                if p.startswith("/"):
                    full = PUB / p.lstrip("/")
                    if not full.is_file():
                        raise FileNotFoundError(f"Missing speaking audio file: {full}")
            counts[q["part"]] += 1
            qs.append(item)
        topics.append({
            "id": t["id"],
            "name": t["name"],
            "kind": t["kind"],
            "period": t.get("period"),
            "category": t.get("category"),
            "questions": qs,
        })

    if len(used) != 301 or counts[3] != 357:
        raise ValueError(f"Unexpected speaking counts: local_used={len(used)}, counts={counts}")
    print(f"Speaking built: {len(topics)} topics, {counts} questions (audio copied={copied}, reused={skipped})")
    return {"meta": {"counts": {f"part{k}": v for k, v in counts.items()}, "topics": len(topics)}, "topics": topics}


def build_ielts_wordbook() -> None:
    dict_dir = PUB / "dict"
    shards_dir = dict_dir / "shards"
    meta_path = dict_dir / "meta.json"
    if not shards_dir.is_dir() or not meta_path.is_file():
        print("Skipping IELTS wordbook: public/dict not present")
        return

    entries: list[dict] = []
    for shard_path in sorted(shards_dir.glob("*.json")):
        shard = json.loads(shard_path.read_text(encoding="utf-8"))
        for e in shard.values():
            tags = e.get("tags") or []
            if "ielts" in tags and " " not in e.get("w", ""):
                entries.append(e)
    entries.sort(key=lambda e: (e.get("f") or 10**9, e.get("w", "").lower()))
    books_dir = dict_dir / "books"
    books_dir.mkdir(parents=True, exist_ok=True)
    (books_dir / "ielts.json").write_text(json.dumps(entries, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    books = [b for b in meta.get("books", []) if b.get("id") != "ielts"]
    books.append({"id": "ielts", "name": "雅思核心词汇", "count": len(entries)})
    meta["books"] = books
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"IELTS wordbook built: {len(entries)} words -> public/dict/books/ielts.json")


def dump_min(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    for sub in ("papers", "keys", "explain"):
        sub_dir = OUT / sub
        sub_dir.mkdir(parents=True, exist_ok=True)
        for old in glob.glob(str(sub_dir / "*.json")):
            os.remove(old)

    idx = json.loads((BANK / "index.json").read_text(encoding="utf-8"))
    wj_raw = json.loads((BANK / "writing-jj.json").read_text(encoding="utf-8"))
    oral_raw = json.loads((BANK / "oral.json").read_text(encoding="utf-8"))

    all_urls = collect_all_image_urls(idx, wj_raw)
    img_map = mirror_images(all_urls)

    # First pass: build all papers
    paper_docs: dict[str, dict] = {}
    view_stats = {"table": 0, "headings": 0, "drag": 0}
    img_groups = 0

    for e in idx["papers"]:
        src = json.loads((BANK / "papers" / f"{e['id']}.json").read_text(encoding="utf-8"))
        if e.get("hit") and "hit" not in src:
            src["hit"] = e["hit"]
        p_doc, k_doc, ex_doc = build_paper_packs(src, img_map)
        paper_docs[e["id"]] = p_doc
        for sec in ("listening", "reading"):
            for s in p_doc.get(sec) or []:
                for g in s["groups"]:
                    if g.get("questionsImg") or g.get("optionsImg"):
                        img_groups += 1
                    if g["type"] == "match":
                        view_stats[g["view"]] += 1
        dump_min(OUT / "papers" / f"{e['id']}.json", p_doc)
        dump_min(OUT / "keys" / f"{e['id']}.json", k_doc)
        dump_min(OUT / "explain" / f"{e['id']}.json", ex_doc)

    # Second pass: compute catalogue entries with resolved listening counts
    entries = []
    for e in idx["papers"]:
        pid = e["id"]
        p_doc = paper_docs[pid]
        l_source = paper_docs[p_doc["listeningRef"]] if p_doc.get("listeningRef") and not p_doc.get("listening") else p_doc
        ql = count_q(l_source, "listening")
        qr = count_q(p_doc, "reading")
        qw = len(p_doc.get("writing") or [])
        skills = [k for k, v in (("listening", ql), ("reading", qr), ("writing", qw)) if v > 0]
        entry = dict(e)
        entry["exam"] = "ielts-gt" if e["family"] == "gt" else "ielts-a"
        entry["skills"] = skills
        entry["fullMock"] = skills == ["listening", "reading", "writing"]
        entry["q"] = {k: v for k, v in (("listening", ql), ("reading", qr), ("writing", qw)) if v > 0}
        entries.append(entry)

    # Writing JJ split: prompt vs sample
    wj_prompts = []
    wj_explain: dict[str, dict] = {}
    for it in wj_raw:
        wid = str(it["id"])
        wj_prompts.append({
            "id": wid,
            "title": it.get("title") or f"Task {it['part']}",
            "part": int(it["part"]),
            "topic": it.get("topic") or "其他",
            "html": rewrite_html_imgs(clean_html(it.get("questionHtml") or it.get("question")), img_map),
            "hitCount": it.get("hitCount") or 0,
            "lastHit": it.get("lastHit"),
            "inPaper": it.get("inPaper"),
        })
        sample_clean = rewrite_html_imgs(clean_html(it.get("sample")), img_map)
        if sample_clean:
            wj_explain[wid] = {"sample": sample_clean}

    dump_min(OUT / "writing-jj.json", wj_prompts)
    dump_min(OUT / "writing-jj-explain.json", wj_explain)

    speaking_out = build_speaking(oral_raw)
    dump_min(OUT / "speaking.json", speaking_out)

    index_out = {
        "version": 1,
        "papers": entries,
        "writingJj": len(wj_prompts),
        "speakingTopics": len(speaking_out["topics"]),
    }
    dump_min(OUT / "index.json", index_out)

    build_ielts_wordbook()

    print(
        f"IELTS packs ready: {len(entries)} papers (fullMock={sum(1 for x in entries if x['fullMock'])}), "
        f"match views={view_stats}, rescued_img_groups={img_groups}, mirrored_imgs={len(img_map)}"
    )


if __name__ == "__main__":
    main()
