"""把 public/papers/pdf/ 下的原卷 PDF 线性化（"快速 Web 浏览"）。

为什么：线上从国内到新加坡只有 0.3–0.6 MB/s，一套卷 3–8 MB。非线性化的 PDF 交叉引用表在文件末尾，
pdf.js 要等整个文件下完才能画第一页；线性化后第一页的对象排在文件开头，边下边画，几秒就能看到卷面。
顺带 deflate + garbage=3，矢量卷能小三分之一，扫描卷不变。

只重写内容：逐页核对页数、文字层逐字相同才替换；单词坐标（.words.json）是 PDF 点坐标，不受影响。
已经线性化的跳过。可以反复运行。

  python -I scripts/linearize_pdfs.py            全部
  python -I scripts/linearize_pdfs.py cet4-2025-12-1 cet6-2023-12-2
  python -I scripts/linearize_pdfs.py --check    只看哪些还没线性化
"""
import os
import sys
import tempfile
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parent.parent
PDF_DIR = ROOT / "public/papers/pdf"
SAVE = dict(linear=True, deflate=True, garbage=3)


def linearize(path: Path) -> str:
    src = fitz.open(path)
    if src.is_fast_webaccess:
        src.close()
        return "已是线性化"
    before = path.stat().st_size
    n = len(src)
    texts = [src[i].get_text() for i in range(n)]
    fd, tmp = tempfile.mkstemp(suffix=".pdf", dir=path.parent)
    os.close(fd)
    try:
        src.save(tmp, **SAVE)
        src.close()
        out = fitz.open(tmp)
        ok = out.is_fast_webaccess and len(out) == n and all(out[i].get_text() == texts[i] for i in range(n))
        out.close()
        if not ok:
            return "核对不一致，没替换"
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    after = path.stat().st_size
    return f"{before / 1e6:.2f}MB -> {after / 1e6:.2f}MB"


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    fitz.TOOLS.mupdf_display_errors(False)
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    check = "--check" in sys.argv
    files = [PDF_DIR / f"{a}.pdf" for a in args] if args else sorted(PDF_DIR.glob("*.pdf"))
    todo = done = 0
    total_before = total_after = 0
    for f in files:
        if check:
            d = fitz.open(f)
            if not d.is_fast_webaccess:
                todo += 1
                print(f"未线性化  {f.name}")
            d.close()
            continue
        b = f.stat().st_size
        r = linearize(f)
        total_before += b
        total_after += f.stat().st_size
        if r != "已是线性化":
            done += 1
            print(f"{f.name:28s} {r}")
    if check:
        print(f"{len(files)} 个，未线性化 {todo} 个")
    else:
        print(f"{len(files)} 个，这次处理 {done} 个，合计 {total_before / 1e6:.0f}MB -> {total_after / 1e6:.0f}MB")


if __name__ == "__main__":
    main()
