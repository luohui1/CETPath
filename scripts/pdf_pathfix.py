"""修卷面空白页（2026-11-12）：有些原卷的页面内容被工具改写过，字形轮廓写成"先画路径、再 q…cm、再填充"：
    0 0 m … l h q 1 0 0 1 104.57 676.50 cm f Q
PDF 规范里路径构造中间不许插 q / cm；MuPDF 能容忍（按填充时的坐标变换画），pdf.js（应用用的）会把这段路径丢掉，
整页只剩几个零星记号 —— 用户看到的"第一页是白的"（cet4-2026-06-1 第 1 页，2026-11-12 报）。

修法：逐个操作扫内容流；路径构造到一半遇到 q/cm/gs 这类状态操作、紧接着就是填充或描边的，把这些状态操作挪到路径前面：
    q 1 0 0 1 104.57 676.50 cm 0 0 m … l h f Q
和 MuPDF 的画法一致（路径坐标按填充时的变换走）。改完逐页比对 MuPDF 渲染（应当几乎一样）才替换，原件存 BACKUP。

  python -I scripts/pdf_pathfix.py scan              只列出有问题的卷和页
  python -I scripts/pdf_pathfix.py apply [id ...]    修好并替换
"""
import json
import os
import re
import shutil
import time
import sys
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "1")
import fitz  # noqa: E402
import numpy as np  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PDF_DIR = ROOT / "public" / "papers" / "pdf"
BACKUP = Path(os.environ.get("PDF_BACKUP", r"D:\Flies\claude\25f93fe317e9d9a4\715290c8-ae94-40fc-a168-1c492acb0efc\pdf-original-backup"))
sys.stdout.reconfigure(encoding="utf-8")

PATH_OPS = {b"m", b"l", b"c", b"v", b"y", b"re", b"h"}
PAINT_OPS = {b"f", b"F", b"f*", b"S", b"s", b"B", b"B*", b"b", b"b*", b"n"}
# 路径中间被插进来的状态操作（只挪这些）。标记内容（BDC/BMC/MP/DP）也会夹在中间：
#   -56.7 0 m … h q /Artifact <<…>> BDC 1 0 0 -1 56.7 827.75 cm W n Q EMC （页眉的裁剪框，cet4-2024-06-3 等）
# 按原顺序整串挪到路径前面，配对的 EMC 还在后面，不会错乱
STATE_OPS = {b"q", b"cm", b"gs", b"w", b"J", b"j", b"M", b"d", b"ri", b"i", b"g", b"G", b"rg", b"RG", b"k", b"K", b"cs", b"CS", b"sc", b"SC", b"scn", b"SCN",
             b"BDC", b"BMC", b"MP", b"DP"}
# 快速筛：路径操作后面紧跟 q
QUICK = re.compile(rb"(?:^|[\s])(?:[mlcvyh]|re)\s+q\s")
NUM = re.compile(rb"[+-]?(\d+\.?\d*|\.\d+)")
WS = b" \t\r\n\f\x00"
DELIM = b"()<>[]{}/%"


def skip_string(data: bytes, i: int) -> int:
    """i 指着 "("，返回字符串结束后的位置（括号可嵌套，反斜杠转义）"""
    depth = 0
    n = len(data)
    while i < n:
        c = data[i]
        if c == 0x5C:
            i += 2
            continue
        if c == 0x28:
            depth += 1
        elif c == 0x29:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return n


def skip_nested(data: bytes, i: int, open_: bytes, close: bytes) -> int:
    """数组 [...] 或字典 <<...>>：里面的字符串整段跳过"""
    depth = 0
    n = len(data)
    while i < n:
        if data[i] == 0x28:
            i = skip_string(data, i)
            continue
        if data.startswith(open_, i):
            depth += 1
            i += len(open_)
            continue
        if data.startswith(close, i):
            depth -= 1
            i += len(close)
            if depth == 0:
                return i
            continue
        i += 1
    return n


def tokens(data: bytes):
    """把内容流切成 (操作数列表, 操作符)；内嵌图（BI…ID…EI）整段当成一个操作符原样保留"""
    i, n = 0, len(data)
    operands: list[bytes] = []
    while i < n:
        ch = data[i]
        if ch in WS:
            i += 1
            continue
        if ch == 0x25:  # % 注释
            j = data.find(b"\n", i)
            i = n if j < 0 else j + 1
            continue
        start = i
        if ch == 0x28:
            i = skip_string(data, i)
        elif data.startswith(b"<<", i):
            i = skip_nested(data, i, b"<<", b">>")
        elif ch == 0x3C:
            j = data.find(b">", i)
            i = n if j < 0 else j + 1
        elif ch == 0x5B:
            i = skip_nested(data, i, b"[", b"]")
        elif ch == 0x2F:
            i += 1
            while i < n and data[i] not in WS and data[i] not in DELIM:
                i += 1
        else:
            while i < n and data[i] not in WS and data[i] not in DELIM:
                i += 1
            word = data[start:i]
            if not word:
                i += 1
                continue
            if NUM.fullmatch(word) or word in (b"true", b"false", b"null"):
                operands.append(word)
                continue
            if word == b"BI":
                m = re.compile(rb"\sEI(?=\s|$)").search(data, i)
                end = n if not m else m.end()
                yield operands, data[start:end]
                operands = []
                i = end
                continue
            yield operands, word
            operands = []
            continue
        operands.append(data[start:i])


def fix_stream(data: bytes):
    """返回 (新内容, 挪了几处)；没问题返回 (None, 0)"""
    if not QUICK.search(data):
        return None, 0
    ops = list(tokens(data))
    out: list[tuple[list[bytes], bytes]] = []
    path: list[tuple[list[bytes], bytes]] = []
    moved = 0
    k = 0
    while k < len(ops):
        args, op = ops[k]
        if op in PATH_OPS:
            path.append((args, op))
            k += 1
            continue
        if path and op in STATE_OPS:
            # 往后看：一串状态操作之后紧接着是填充/描边（或先 W / W* 裁剪再 n），才把这串挪到路径前面。
            # 裁剪的写法见 kaoyan1-2019：0 0 595.3 841.9 re q 1 0 0 -1 0 841.9 cm W* n
            j = k
            while j < len(ops) and ops[j][1] in STATE_OPS:
                j += 1
            clip = j < len(ops) and ops[j][1] in (b"W", b"W*")
            p = j + 1 if clip else j
            if p < len(ops) and ops[p][1] in PAINT_OPS:
                out.extend(ops[k:j])
                out.extend(path)
                out.extend(ops[j : p + 1])
                path = []
                moved += 1
                k = p + 1
                continue
        out.extend(path)
        path = []
        out.append((args, op))
        k += 1
    out.extend(path)
    if not moved:
        return None, 0
    return b"\n".join(b" ".join(a + [o]) for a, o in out) + b"\n", moved


def content_xrefs(doc) -> list[int]:
    """要查的内容流：每页的内容流，加上所有表单对象（Form XObject）——
    cet4-2018-12-3 第 4 页的内容整个包在两层表单里（页面 → fzFrm0 → fullpage），只查页面内容流会漏掉"""
    xs = {x for page in doc for x in page.get_contents()}
    for x in range(1, doc.xref_length()):
        try:
            if doc.xref_is_stream(x) and re.search(r"/Subtype\s*/Form\b", doc.xref_object(x, compressed=True)):
                xs.add(x)
        except Exception:
            continue
    return sorted(xs)


def bad_streams(doc) -> list[int]:
    return [x for x in content_xrefs(doc) if QUICK.search(doc.xref_stream(x) or b"")]


def bad_pages(doc):
    """有问题的内容流用在哪几页（表单按页面资源里直接引用的算；嵌套更深的统一记成 "表单"）"""
    bad = set(bad_streams(doc))
    if not bad:
        return []
    res = []
    for page in doc:
        used = set(page.get_contents()) | {x[0] for x in page.get_xobjects()}
        if used & bad:
            res.append(page.number + 1)
    return res or [f"表单 {sorted(bad)}"]


def render_diff(a: fitz.Page, b: fitz.Page) -> float:
    pa = a.get_pixmap(matrix=fitz.Matrix(0.8, 0.8), colorspace=fitz.csGRAY)
    pb = b.get_pixmap(matrix=fitz.Matrix(0.8, 0.8), colorspace=fitz.csGRAY)
    if (pa.width, pa.height) != (pb.width, pb.height):
        return 1.0
    ia = np.frombuffer(pa.samples, np.uint8).reshape(pa.height, pa.width) < 128
    ib = np.frombuffer(pb.samples, np.uint8).reshape(pb.height, pb.width) < 128
    return float((ia != ib).mean())


def apply(pid: str):
    src = PDF_DIR / f"{pid}.pdf"
    doc = fitz.open(src)
    total = 0
    pages = bad_pages(doc)
    for x in content_xrefs(doc):
        new, moved = fix_stream(doc.xref_stream(x) or b"")
        if new is not None:
            doc.update_stream(x, new)
            total += moved
    if not total:
        doc.close()
        return None
    tmp = src.with_suffix(".fix.pdf")
    doc.save(tmp, garbage=3, deflate=True)
    doc.close()
    a, b = fitz.open(src), fitz.open(tmp)
    # 表单可能被好几页共用：每页都比
    worst = max(render_diff(a[i], b[i]) for i in range(min(len(a), len(b))))
    left = bad_streams(b)
    same_count = len(a) == len(b)
    a.close()
    b.close()
    if worst > 0.002 or left or not same_count:
        tmp.unlink()
        return f"{pid}：没替换（渲染差 {worst:.2%}，还剩 {left}）"
    BACKUP.mkdir(parents=True, exist_ok=True)
    if not (BACKUP / src.name).exists():
        shutil.copy2(src, BACKUP / src.name)
    # Windows 上文件刚被别的进程（开发服务器、杀毒）读着时换不了，等一下再试
    for k in range(10):
        try:
            os.replace(tmp, src)
            break
        except PermissionError:
            if k == 9:
                raise
            time.sleep(1)
    return f"{pid}：第 {pages} 页挪了 {total} 处，渲染差 {worst:.3%}"


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "scan"
    idx = json.loads((ROOT / "public" / "papers" / "index.json").read_text("utf-8"))
    ids = [x["id"] for x in idx]
    want = sys.argv[2:]
    if want:
        ids = [i for i in ids if any(i.startswith(w) for w in want)]
    for pid in ids:
        p = PDF_DIR / f"{pid}.pdf"
        if not p.exists():
            continue
        if cmd == "scan":
            d = fitz.open(p)
            bad = bad_pages(d)
            d.close()
            if bad:
                print(pid, bad, flush=True)
        else:
            r = apply(pid)
            if r:
                print(r, flush=True)


if __name__ == "__main__":
    main()
