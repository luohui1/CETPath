"""把网上买来的四六级资料包规整成只含真题的资料库：按 四级/六级 → 场次 分文件夹，文件统一命名。

  真题/四级/2024年12月/2024年12月四级第1套-真题.pdf
                      2024年12月四级第1套-解析.pdf     答案解析（听力原文也在里面）
                      2024年12月四级第1套-听力.mp3
                      2024年12月四级第1套-真题.docx    Word 版
  真题/清单.md、manifest.json                         每场每套有什么、缺什么、PDF 能不能直接导入

只收 2015 年改版以后的历年真题（真题卷、解析、听力、Word 版）。模拟卷、押题卷、词汇、答题卡、作文模板、
预测，以及卖家的赠品（"一键打印版"合集、2015 年以前的旧题）都不收。

用法：
  npm run organize:cet              把 真题/ 下的资料包整理进 真题/四级、真题/六级（硬链接，不占额外空间，不动资料包）
  npm run organize:cet -- --clean   整理并核对无误后，把资料包整个移到回收站（只剩整理好的真题）
以后买了新的资料包，放进 真题/ 再运行一次即可。
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import fitz

sys.path.insert(0, str(Path(__file__).resolve().parent))
from inspect_pdf import VERDICT, pdf_quality  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "真题"
EXAMS = {"cet4": "四级", "cet6": "六级"}
KEEP = {*EXAMS.values(), "清单.md", "manifest.json"}  # 真题/ 下整理好的东西，其余都算资料包
KINDS = {"paper": "真题", "answers": "解析", "audio": "听力", "docx": "真题"}
CN_NUM = {"一": 1, "二": 2, "三": 3, "1": 1, "2": 2, "3": 3}
SKIP_NOTES = re.compile(r"资源使用|免解压|不要做|打印|包邮")


def exam_of(rel):
    """四级还是六级：看路径里的 CET4、CET6（资料包总目录叫"四六级"，不能只看汉字；有一处写成了 CTE6）"""
    m = re.search(r"C[ET]{2}\s*([46])", str(rel), re.I)
    if m:
        return f"cet{m.group(1)}"
    name = rel.name.replace("四六级", "")
    return "cet6" if "六级" in name else "cet4" if "四级" in name else None


def session_of(rel):
    """考试年月：文件名 "2024.12…" 或文件夹 "2024年12月CET4题+解+音频" """
    for part in [rel.name, *[p.name for p in rel.parents]]:
        m = re.search(r"(20\d\d)\s*[年.\-]\s*(\d{1,2})(?!\d)", part)
        if m and 1 <= int(m.group(2)) <= 12:
            return int(m.group(1)), int(m.group(2))
    return None


def sets_of(name):
    """属于哪几套：(1,)、(2, 3)（"第2、3套"）；整场共用的文件（"全3套"）返回 ()，并给出套数"""
    m = re.search(r"第\s*([1-3一二三](?:\s*[、,，和]\s*[1-3一二三])*)\s*套", name)
    if m:
        return tuple(CN_NUM[c] for c in re.findall(r"[1-3一二三]", m.group(1))), None
    m = re.search(r"全\s*(\d)\s*套", name)
    if m:
        return (), int(m.group(1))
    return (1,), None  # 只考了一套（如 2020 年 7 月）


def kind_of(rel):
    """真题卷、答案解析、听力还是 Word 版：先看文件名，再看所在的"03、答案解析"这类文件夹"""
    name, folder, low = rel.name, rel.parent.name, rel.name.lower()
    if low.endswith(".mp3"):
        return "audio"
    if low.endswith(".pdf"):
        return "answers" if re.search(r"解析|答案|详解", name) or "解析" in folder else "paper"
    if low.endswith((".docx", ".doc")):
        return "docx"
    return None


def is_real(rel):
    """只要 2015 年以后的历年真题：跳过赠品（一键打印版、旧题压缩包）、模拟卷、押题卷、词汇、模板、预测。
    第一个资料包把真题放在"历年真题"文件夹里；2026-11 补的一批每场一个文件夹，叫"2019年06月CET6题+解+音频"
    （有的套在"1990年-2018年真题资料【合集】"下面）"""
    if re.search(r"赠|一键打印|合并版|模拟|押题|不建议做", str(rel)):
        return False
    folders = [p.name for p in rel.parents]
    return "历年真题" in str(rel.parent) or any(re.match(r"20\d\d年\d\d月\s*C[ET]{2}\s*[46]", f, re.I) for f in folders)


def target(exam, year, month, sets, total, kind, suffix):
    """统一的文件名，如 2024年12月四级第1套-真题.pdf；整场共用的听力叫"各套通用"，合订的 Word 叫"全3套" """
    if sets:
        label = "第" + "、".join(map(str, sets)) + "套"
    else:
        label = "各套通用" if kind == "audio" else f"全{total}套"
    ext = ".mp3" if kind == "audio" else suffix.lower()
    name = f"{year}年{month:02d}月{EXAMS[exam]}{label}-{KINDS[kind]}{ext}"
    return LIB / EXAMS[exam] / f"{year}年{month:02d}月" / name


def link(src, dst):
    """硬链接（同一块磁盘不占额外空间）。同名不同内容的文件（另一个版本的解析、重新扫描的真题）放到 备选/ 里留着，
    不参与导入——导入脚本把"-真题（2）"当第 2 套（第一个资料包里确实是这样标漏的），所以不能再用编号。
    已经按编号放好的（2）（3）保持原样"""
    dst.parent.mkdir(parents=True, exist_ok=True)
    same = lambda a, b: os.path.samefile(a, b) or a.stat().st_size == b.stat().st_size
    if not dst.exists():
        os.link(src, dst)
        return dst
    if same(src, dst):
        return dst  # 资料包里重复的同一份文件
    n = 2
    while True:
        numbered = dst.with_stem(re.sub(r"（\d+）$", "", dst.stem) + f"（{n}）")
        if not numbered.exists():
            break
        if same(src, numbered):
            return numbered
        n += 1
    alt = dst.parent / "备选" / src.name
    alt.parent.mkdir(exist_ok=True)
    if alt.exists() and not same(src, alt):
        alt = alt.with_stem(alt.stem + f"（{src.stat().st_size // 1024}K）")
    if not alt.exists():
        os.link(src, alt)
    return alt


def listening_note(paper):
    """第 3 套这类卷子常写着"本套听力与第二套相同，不再重复列出"：读出来，清单里就不算缺听力"""
    try:
        doc = fitz.open(paper)
        text = re.sub(r"\s+", "", "".join(doc[i].get_text("text") for i in range(min(3, len(doc)))))
    except Exception:
        return None
    if re.search(r"(?:仅|只|一共|共)考了?(?:1|一)套听力", text):
        return "同第1套"
    m = re.search(r"听力(?:试题)?(?:与|同)第([一二12])套", text)
    if m:
        return f"同第{CN_NUM[m.group(1)]}套"
    if re.search(r"听力与前(?:2|两)套", text):
        return "同前两套"
    return None


def organize():
    packages = [p for p in LIB.iterdir() if p.name not in KEEP]
    placed, notes, skipped = [], {}, 0
    for pkg in packages:
        for path in sorted(pkg.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(LIB)
            exam, when = exam_of(rel), session_of(rel)
            if not is_real(rel) or not exam or not when or when[0] < 2015:
                skipped += 1
                continue
            if path.suffix.lower() == ".txt":
                if not SKIP_NOTES.search(path.stem):
                    notes.setdefault((exam, *when), set()).add(path.stem)
                continue
            kind = kind_of(rel)
            if not kind or path.name.endswith(".downloading"):
                skipped += 1
                continue
            sets, total = sets_of(path.name)
            dst = link(path, target(exam, *when, sets, total, kind, path.suffix))
            placed.append({"src": path, "dst": dst, "exam": exam, "year": when[0], "month": when[1], "sets": sets, "kind": kind})
    return placed, notes, skipped


def build_manifest(notes):
    """从整理好的文件夹读出每场每套有什么（不依赖资料包，资料包删了也能重新生成清单）。
    资料包里的说明只在整理时读得到，所以沿用上一次清单里记下的"""
    old = LIB / "manifest.json"
    if old.exists():
        for s in json.loads(old.read_text("utf-8")).get("sittings", []):
            notes.setdefault((s["exam"], s["year"], s["month"]), set()).update(s.get("notes", []))
    sittings = []
    for exam, label in EXAMS.items():
        for folder in sorted((LIB / label).glob("20*年*月")):
            m = re.match(r"(\d{4})年(\d{2})月", folder.name)
            year, month = int(m.group(1)), int(m.group(2))
            sets = {}
            shared = []
            for f in sorted(folder.iterdir()):
                fm = re.search(r"月.级(第([\d、]+)套|全\d套|各套通用)-(真题|解析|听力)", f.name)
                if not fm:
                    continue
                kind = {"真题": "docx" if f.suffix in (".docx", ".doc") else "paper", "解析": "answers", "听力": "audio"}[fm.group(3)]
                nums = [int(x) for x in fm.group(2).split("、")] if fm.group(2) else []
                if not nums:
                    shared.append((kind, f.name))
                for n in nums:
                    sets.setdefault(n, {})[kind] = f.name
            for kind, name in shared:  # 整场共用的文件算到每一套
                for n in sets or {1: {}}:
                    sets.setdefault(n, {}).setdefault(kind, name)
            entries = []
            for n, files in sorted(sets.items()):
                paper = folder / files["paper"] if "paper" in files else None
                entries.append(
                    {
                        "id": f"{exam}-{year}-{month:02d}-{n}",
                        "set": n,
                        "files": files,
                        "paper": pdf_quality(paper) if paper else None,
                        "listening": None if "audio" in files or not paper else listening_note(paper),
                    }
                )
            sittings.append({"exam": exam, "year": year, "month": month, "dir": str(folder.relative_to(ROOT)), "sets": entries, "notes": sorted(notes.get((exam, year, month), []))})
    return {"sittings": sittings}


def report(m):
    def status(e):
        if not e["paper"]:
            return "缺真题卷"
        if "error" in e["paper"]:
            return "真题 PDF 打不开"
        return "可以导入" if e["paper"]["text"] == "ok" else VERDICT[e["paper"]["text"]]

    rows = [
        "# 四六级真题清单",
        "",
        "由 `npm run organize:cet` 生成。只收 2015 年改版以后的历年真题；每场一个文件夹，文件名形如 `2024年12月四级第1套-真题.pdf`、`-解析.pdf`、`-听力.mp3`、`-真题.docx`。",
        "",
    ]
    for exam, label in EXAMS.items():
        ss = [s for s in m["sittings"] if s["exam"] == exam]
        if not ss:
            continue
        es = [e for s in ss for e in s["sets"]]
        rows += [
            f"## {label}：{len(ss)} 场 {len(es)} 套（{ss[0]['year']}年{ss[0]['month']}月 – {ss[-1]['year']}年{ss[-1]['month']}月）",
            "",
            f"可以直接导入 {sum(status(e) == '可以导入' for e in es)} 套；有解析 {sum('answers' in e['files'] for e in es)} 套；"
            f"有听力录音 {sum('audio' in e['files'] for e in es)} 套，另有 {sum(bool(e['listening']) for e in es)} 套卷面注明听力和别的套相同、不再列出。",
            "",
            "| 场次 | 套 | 真题 | 解析 | 听力 | Word | 状态 |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
        for s in ss:
            for e in s["sets"]:
                f = e["files"]
                has = lambda k: "✓" if k in f else "—"
                audio = "✓" if "audio" in f else e["listening"] or "—"
                rows.append(f"| {s['year']}年{s['month']:02d}月 | 第{e['set']}套 | {has('paper')} | {has('answers')} | {audio} | {has('docx')} | {status(e)} |")
        rows.append("")
        noted = [s for s in ss if s["notes"]]
        if noted:
            rows += [f"{label}资料包里的说明：", ""] + [f"- {s['year']}年{s['month']}月：{'；'.join(s['notes'])}" for s in noted] + [""]
    return "\n".join(rows)


def recycle(path):
    """整个文件夹移到回收站（能找回），不是永久删除。逐个文件移，整个文件夹一次移会被系统拒绝"""
    script = r"""
Add-Type -AssemblyName Microsoft.VisualBasic
$dir = $env:RECYCLE_PATH
foreach ($f in Get-ChildItem -LiteralPath $dir -Recurse -File -Force) {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($f.FullName, 'OnlyErrorDialogs', 'SendToRecycleBin')
}
Get-ChildItem -LiteralPath $dir -Recurse -Directory -Force | Sort-Object { $_.FullName.Length } -Descending | ForEach-Object {
  if (-not (Get-ChildItem -LiteralPath $_.FullName -Force)) { Remove-Item -LiteralPath $_.FullName -Force }
}
if (-not (Get-ChildItem -LiteralPath $dir -Force)) { Remove-Item -LiteralPath $dir -Force }
"""
    result = subprocess.run(["powershell", "-NoProfile", "-Command", script], env={**os.environ, "RECYCLE_PATH": str(path)})
    if result.returncode or path.exists():
        sys.exit(f"{path.name} 没能移到回收站（在沙箱里运行时回收站不可写，请在自己的终端里运行）")


def main(clean):
    placed, notes, skipped = organize()
    manifest = build_manifest(notes)
    (LIB / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), "utf-8")
    (LIB / "清单.md").write_text(report(manifest), "utf-8")
    print(report(manifest))
    print(f"整理了 {len(placed)} 个真题文件，跳过 {skipped} 个非真题文件")
    if not clean:
        return
    # 核对：资料包里每个真题文件都已经在整理好的文件夹里（是同一份文件），才删资料包
    bad = [p["src"] for p in placed if not p["dst"].exists() or not os.path.samefile(p["src"], p["dst"])]
    if bad:
        sys.exit(f"有 {len(bad)} 个文件没整理好，先不删资料包：{bad[:3]}")
    for pkg in [p for p in LIB.iterdir() if p.name not in KEEP]:
        recycle(pkg)
        print(f"已移到回收站：{pkg.name}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    fitz.TOOLS.mupdf_display_errors(False)  # 资料包里的 PDF 常有小错误，不影响读取
    main("--clean" in sys.argv)
