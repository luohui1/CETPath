"""从考试院《全国大学英语四、六级考试大纲（2016 年修订版）》PDF 导入官方样卷。

输出：
  public/papers/pdf/<id>.pdf          样卷那几页（原卷）
  public/papers/pdf/<id>.words.json   每页可点击单词的坐标和句子
  public/papers/<id>.json             试卷：题目分组、答案、题目在原卷中的位置
  scripts/audio/<id>.json             听力原文台词，用 npm run build:audio 合成音频

用法（先下载 PDF 到 data/raw/neea/cet-syllabus-2016.pdf）：
  python -I scripts/import_neea_sample.py cet4
  python -I scripts/import_neea_sample.py cet6
"""
import json
import re
import sys
from pathlib import Path

import fitz

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pdf_words import ROOT, Extractor, line_text, load_vocab, page_data  # noqa: E402

SRC = ROOT / "data/raw/neea/cet-syllabus-2016.pdf"

CONFIGS = {
    "cet4": {
        "id": "cet4-sample-2016",
        "exam": "cet4",
        "title": "大学英语四级考试样卷",
        "paper": (150, 161),  # PDF 页码（从 1 开始）
        "script": (162, 167),
        "answers": (168, 168),
        # 阅读各部分的选项字母
        "reading_options": {"A": "ABCDEFGHIJKLMNO", "B": "ABCDEFGHIJK", "C": "ABCD"},
    },
    "cet6": {
        "id": "cet6-sample-2016",
        "exam": "cet6",
        "title": "大学英语六级考试样卷",
        "paper": (172, 183),
        "script": (184, 190),  # 第 190 页后半是参考答案
        "answers": (190, 191),
        "reading_options": {"A": "ABCDEFGHIJKLMNO", "B": "ABCDEFGHIJKLMNO", "C": "ABCD"},
    },
}

NOISE = re.compile(r"^(全国大学英语四、六级考试大纲.*|样|卷|\d{1,3})$")
SEGMENT = re.compile(r"^(News Report|Conversation|Passage|Recording) (One|Two|Three|Four)$")
QUESTIONS = re.compile(r"^Questions (\d+) (?:and|to) (\d+) are based on (.*)$")
QLINE = re.compile(r"^(\d+)\. ?(.*)$")
NUM_WORDS = {"One": 1, "Two": 2, "Three": 3, "Four": 4}


def text_lines(ex, doc, first, last):
    out = []
    for n in range(first, last + 1):
        for tokens in ex.lines(doc[n - 1]):
            t = line_text(tokens).strip()
            if t and not NOISE.match(t):
                out.append(t)
    return out


def split_sentences(text):
    parts = re.split(r"(?<=[.?!])\s+(?=[A-Z“\"])", text)
    return [p.strip() for p in parts if p.strip()]


def parse_script(lines):
    """听力原文 -> [{id, label, speakers, body: [(说话人, 文字)], questions: {题号: 文字}, range}]"""
    segments = []
    seg = None
    mode = None
    for line in lines:
        # 参考答案开始（标题在文字层里可能是乱码，就认后面的 Part II）
        if line.startswith("【参考答案】") or line == "Part II Listening Comprehension":
            break
        m = SEGMENT.match(line)
        if m:
            kind = m.group(1).split()[0].lower()
            seg = {"id": f"{kind[:4]}{NUM_WORDS[m.group(2)]}", "label": line, "body": [], "questions": {}, "range": None}
            segments.append(seg)
            mode = "body"
            continue
        if seg is None or line.startswith("Section ") or line.startswith("Directions"):
            if line.startswith("Section "):
                mode = None
            continue
        if mode is None:
            continue  # Section 说明文字
        m = QUESTIONS.match(line)
        if m:
            seg["range"] = (int(m.group(1)), int(m.group(2)))
            seg["intro"] = line
            mode = "questions"
            continue
        if mode == "questions":
            m = QLINE.match(line)
            lo, hi = seg["range"]
            if m and lo <= int(m.group(1)) <= hi:
                seg["questions"][int(m.group(1))] = m.group(2)
                last_q = int(m.group(1))
            elif seg["questions"]:
                seg["questions"][last_q] += " " + line
            continue
        m = re.match(r"^([MW]):\s*(.*)$", line)
        if m:
            seg["body"].append([m.group(1), m.group(2)])
        elif seg["body"]:
            seg["body"][-1][1] += " " + line
        else:
            seg["body"].append([None, line])
    return segments


def parse_answers(lines):
    answers = {}
    reference = []
    in_translation = False
    for line in lines:
        if line.startswith("Part IV Translation"):
            in_translation = True
            continue
        if in_translation:
            reference.append(line)
        else:
            for num, key in re.findall(r"(\d+)\. ?([A-O])\b", line):
                answers[int(num)] = key
    return answers, " ".join(reference).strip()


def box(tokens):
    r = lambda v: round(v, 1)
    return [r(min(t["x0"] for t in tokens)), r(min(t["y0"] for t in tokens)), r(max(t["x1"] for t in tokens)), r(max(t["y1"] for t in tokens))]


# 各部分标题，专项训练按这里截取原卷
PART_LABELS = {"writing": "Part I Writing", "listening": "Part II Listening Comprehension", "reading": "Part III Reading Comprehension", "translation": "Part IV Translation"}


def find_positions(ex, doc, first, last, blank_range):
    """原卷上的定位点，值为 (页序号从 1 开始, [x0, y0, x1, y1])：
    - 题号：行首 "8.A) ..." / "46.What ..." 里的 "8."；
    - 选词填空的空位：段落中间的数字（blank_range 内）；
    - 标题：Part I Writing 等；
    - 听力题组说明行："Questions 1 and 2 are based on ..." -> ("group", 1, 2)"""
    pos = {}
    in_bank = False
    in_reading = False  # Part III 里的 Section A/B/C 才是阅读的三种题型，听力也有 Section A/B/C
    for k, n in enumerate(range(first, last + 1)):
        for tokens in ex.lines(doc[n - 1]):
            text = line_text(tokens)
            # 排除页首的 "1.全国大学英语四级考试样卷"
            if len(tokens) >= 3 and tokens[0]["t"].isdigit() and tokens[1]["t"] == "." and re.match(r"[A-Za-z]", tokens[2]["t"]):
                pos.setdefault(int(tokens[0]["t"]), (k + 1, box(tokens[:2])))
            for label in PART_LABELS.values():
                if text.startswith(label):
                    pos.setdefault(label, (k + 1, box(tokens[:2])))
                    in_bank = in_reading = label.startswith("Part III")
            m = re.match(r"^Section ([ABC])\b", text)
            if m and in_reading:
                pos.setdefault(("reading", m.group(1)), (k + 1, box(tokens[:2])))
            if text.startswith("Section B"):
                in_bank = False
            m = re.match(r"^Questions (\d+) (?:and|to) (\d+) are based on", text)
            if m:
                pos.setdefault(("group", int(m.group(1)), int(m.group(2))), (k + 1, box(tokens[:1])))
            elif in_bank:
                for i, t in enumerate(tokens):
                    # 空位也可能在行首（如 "29, but ..."），但单独一个数字的行是页码
                    if (i or len(tokens) > 1) and t["t"].isdigit() and blank_range[0] <= int(t["t"]) <= blank_range[1]:
                        pos.setdefault(int(t["t"]), (k + 1, box([t])))
    return pos


def question(num, options, answers, pos):
    q = {"id": f"q{num}", "number": num, "options": [{"key": k, "text": ""} for k in options], "answer": answers[num]}
    if num in pos:
        q["page"], q["box"] = pos[num]
    return q


def build(name):
    cfg = CONFIGS[name]
    doc = fitz.open(SRC)
    ex = Extractor(doc, load_vocab())
    first, last = cfg["paper"]
    ex.calibrate([doc[n - 1] for n in range(first, cfg["answers"][1] + 1)])

    out_dir = ROOT / "public/papers/pdf"
    out_dir.mkdir(parents=True, exist_ok=True)
    pid = cfg["id"]

    # 1. 原卷页
    part = fitz.open()
    part.insert_pdf(doc, from_page=first - 1, to_page=last - 1)
    part.save(out_dir / f"{pid}.pdf", garbage=4, deflate=True, linear=True)

    # 2. 每页单词
    pages = []
    for n in range(first, last + 1):
        page = doc[n - 1]
        data = page_data(ex, page)
        pages.append({"width": round(page.rect.width, 1), "height": round(page.rect.height, 1), **data})
    (out_dir / f"{pid}.words.json").write_text(json.dumps({"pages": pages}, ensure_ascii=False, separators=(",", ":")), "utf-8")

    # 3. 听力原文、答案、题目位置
    segments = parse_script(text_lines(ex, doc, *cfg["script"]))
    answers, translation_ref = parse_answers(text_lines(ex, doc, *cfg["answers"]))
    listen_hi = max(seg["range"][1] for seg in segments)
    pos = find_positions(ex, doc, first, last, (listen_hi + 1, listen_hi + 10))

    listening_groups = []
    for seg in segments:
        lo, hi = seg["range"]
        group = {
            "id": seg["id"],
            "title": seg["label"],
            "audioSegment": seg["id"],
            "questions": [question(n, "ABCD", answers, pos) for n in range(lo, hi + 1)],
        }
        # 卷面上 "Questions 1 and 2 are based on ..." 那行，用来放播放按钮
        anchor = pos.get(("group", lo, hi))
        if anchor:
            group["anchor"] = {"page": anchor[0], "box": anchor[1]}
        listening_groups.append(group)

    ro = cfg["reading_options"]
    reading_groups = [
        {"id": "ra", "title": "Section A · 选词填空", "questions": [question(n, ro["A"], answers, pos) for n in range(listen_hi + 1, listen_hi + 11)]},
        {"id": "rb", "title": "Section B · 段落信息匹配", "questions": [question(n, ro["B"], answers, pos) for n in range(listen_hi + 11, listen_hi + 21)]},
        {"id": "rc1", "title": "Section C · Passage One", "questions": [question(n, ro["C"], answers, pos) for n in range(listen_hi + 21, listen_hi + 26)]},
        {"id": "rc2", "title": "Section C · Passage Two", "questions": [question(n, ro["C"], answers, pos) for n in range(listen_hi + 26, listen_hi + 31)]},
    ]

    def subjective(qid, label, key, reference=None):
        q = {"id": qid, "number": 0, "label": label}
        if reference:
            q["reference"] = reference
        if key in pos:
            q["page"], q["box"] = pos[key]
        return q

    paper = {
        "id": pid,
        "exam": cfg["exam"],
        "year": 2016,
        "title": cfg["title"],
        "label": "官方样卷",
        "note": "来源：教育部教育考试院《全国大学英语四、六级考试大纲（2016 年修订版）》所附官方样卷。官方录音暂缺，听力音频由电脑语音根据听力原文合成。",
        "durationMinutes": 125,
        "pdf": {"src": f"/papers/pdf/{pid}.pdf", "words": f"/papers/pdf/{pid}.words.json"},
        "sections": [
            {"id": "writing", "part": "Part I", "title": "Writing", "kind": "writing", "groups": [{"id": "w", "questions": [subjective("w1", "作文", "Part I Writing")]}]},
            {"id": "listening", "part": "Part II", "title": "Listening Comprehension", "kind": "listening", "groups": listening_groups},
            # 阅读分成三种题型：选词填空、长篇阅读（段落信息匹配）、仔细阅读
            {"id": "reading-a", "part": "Part III", "title": "Reading Comprehension", "subtitle": "Section A", "kind": "banked", "groups": reading_groups[:1]},
            {"id": "reading-b", "part": "Part III", "title": "Reading Comprehension", "subtitle": "Section B", "kind": "matching", "groups": reading_groups[1:2]},
            {"id": "reading-c", "part": "Part III", "title": "Reading Comprehension", "subtitle": "Section C", "kind": "reading", "groups": reading_groups[2:]},
            {"id": "translation", "part": "Part IV", "title": "Translation", "kind": "translation", "groups": [{"id": "t", "questions": [subjective("t1", "翻译", "Part IV Translation", translation_ref)]}]},
        ],
    }
    for sec in paper["sections"]:
        anchor = pos.get(("reading", sec["subtitle"][-1])) if sec["id"].startswith("reading-") else pos.get(PART_LABELS[sec["id"]])
        if anchor:
            sec["anchor"] = {"page": anchor[0], "box": anchor[1]}
    paper_path = ROOT / "public/papers" / f"{pid}.json"
    if paper_path.exists():
        # 保留 build:audio 写进去的音频时间轴，重新导入时不用再合成一遍
        old = json.loads(paper_path.read_text("utf-8"))
        if "audio" in old:
            paper["audio"] = old["audio"]
    paper_path.write_text(json.dumps(paper, ensure_ascii=False, indent=2) + "\n", "utf-8")

    # 4. 听力台词：新闻和短文按句切开，对话按轮次
    audio = {"paperId": pid, "voices": {"N": "Microsoft David Desktop", "R": "Microsoft Zira Desktop", "M": "Microsoft David Desktop", "W": "Microsoft Zira Desktop"}, "segments": []}
    for seg in segments:
        lines = [{"voice": "N", "text": seg["label"] + ".", "pause": 1}]
        for speaker, text in seg["body"]:
            if speaker:
                lines.append({"voice": speaker, "speaker": speaker, "text": text})
            else:
                lines.extend({"voice": "R", "text": s} for s in split_sentences(text))
        lines[-1]["pause"] = 1.5
        lines.append({"voice": "N", "text": seg["intro"], "pause": 1})
        for num, text in seg["questions"].items():
            lines.append({"voice": "N", "text": f"Question {num}. {text}", "pause": 5})
        audio["segments"].append({"id": seg["id"], "label": seg["label"], "lines": lines})
    (ROOT / "scripts/audio" / f"{pid}.json").write_text(json.dumps(audio, ensure_ascii=False, indent=2) + "\n", "utf-8")

    words = sum(len(p["w"]) for p in pages)
    anchors = sum(1 for g in listening_groups if "anchor" in g)
    print(f"{pid}: {last - first + 1} 页，{words} 个可点击单词；听力 {len(segments)} 段（卷面定位 {anchors} 段）；答案 {len(answers)} 个；定位到题号 {sum(1 for k in pos if isinstance(k, int))} 个")
    missing = [n for n in range(1, listen_hi + 31) if n not in answers]
    if missing:
        print("缺少答案：", missing)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    build(sys.argv[1] if len(sys.argv) > 1 else "cet4")
