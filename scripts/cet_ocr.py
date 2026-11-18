"""扫描件文字识别（给 import_cet.py 用）：用 OpenCV 自带的 DNN 跑 rapidocr 安装包里的 PP-OCRv4 模型。

为什么不直接用 rapidocr：这台机器上 onnxruntime 和 numpy 2 不兼容，rapidocr 会崩。
这里只借它的模型文件（det / rec 两个 onnx，不联网），推理交给 cv2.dnn。

用法（在别的脚本里）：
    from cet_ocr import available, ocr_page
    lines = ocr_page(page)   # [{"text", "x0", "y0", "x1", "y1", "score"}]，坐标是 PDF 点，按从上到下、从左到右排
"""
import json
import math
import os
import re
import struct
import sys
from functools import lru_cache
from pathlib import Path

# 多进程并行时每个进程只用一个线程，免得抢满 CPU
for _k in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_k, "1")

import cv2
import numpy as np

cv2.setNumThreads(1)
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data/cache/cet-ocr"


def _model_dir():
    for p in sys.path:
        d = Path(p) / "rapidocr_onnxruntime" / "models"
        if d.is_dir():
            return d
    for d in (Path(sys.prefix) / "Lib/site-packages/rapidocr_onnxruntime/models", Path(sys.base_prefix) / "Lib/site-packages/rapidocr_onnxruntime/models"):
        if d.is_dir():
            return d
    return None


def available():
    d = _model_dir()
    return bool(d and (d / "ch_PP-OCRv4_det_infer.onnx").exists() and (d / "ch_PP-OCRv4_rec_infer.onnx").exists())


def _read_varint(buf, i):
    shift = value = 0
    while True:
        b = buf[i]
        i += 1
        value |= (b & 0x7F) << shift
        if not b & 0x80:
            return value, i
        shift += 7


def _character_list(path):
    """识别模型的字表存在 onnx 的 metadata_props 里（ModelProto 第 14 个字段）；这里手工解析 protobuf，不依赖 onnx 包"""
    buf = Path(path).read_bytes()
    i, n = 0, len(buf)
    while i < n:
        tag, i = _read_varint(buf, i)
        field, wire = tag >> 3, tag & 7
        if wire == 0:
            _, i = _read_varint(buf, i)
        elif wire == 1:
            i += 8
        elif wire == 5:
            i += 4
        elif wire == 2:
            ln, i = _read_varint(buf, i)
            if field == 14:
                entry = buf[i : i + ln]
                j, key, val = 0, None, None
                while j < len(entry):
                    t, j = _read_varint(entry, j)
                    l2, j = _read_varint(entry, j)
                    s = entry[j : j + l2].decode("utf-8")
                    j += l2
                    if t >> 3 == 1:
                        key = s
                    else:
                        val = s
                if key == "character":
                    return val.splitlines()
            i += ln
        else:
            raise ValueError("onnx 文件格式不对")
    raise ValueError("识别模型里没有字表")


def _fields(buf):
    """protobuf 逐字段读出：(字段号, 值)；长度前缀的值是 bytes，变长整数是 int"""
    i, n = 0, len(buf)
    while i < n:
        tag, i = _read_varint(buf, i)
        field, wire = tag >> 3, tag & 7
        if wire == 0:
            v, i = _read_varint(buf, i)
        elif wire == 1:
            v, i = buf[i : i + 8], i + 8
        elif wire == 5:
            v, i = buf[i : i + 4], i + 4
        elif wire == 2:
            ln, i = _read_varint(buf, i)
            v, i = buf[i : i + ln], i + ln
        else:
            raise ValueError("onnx 文件格式不对")
        yield field, v


_DTYPES = {1: np.float32, 6: np.int32, 7: np.int64, 9: np.bool_, 11: np.float64}


def _s64(v):
    return v - (1 << 64) if v >= 1 << 63 else v


def _packed(buf, fmt):
    return list(struct.unpack(f"<{len(buf) // struct.calcsize(fmt)}{fmt}", buf))


def _tensor(buf):
    dims, dtype, raw, name, floats, ints = [], 1, None, "", [], []
    for f, v in _fields(buf):
        if f == 1:
            dims += _packed(v, "q") if isinstance(v, bytes) else [_s64(v)]
        elif f == 2:
            dtype = v
        elif f == 4:
            floats = _packed(v, "f")
        elif f == 7:
            ints = _packed(v, "q") if isinstance(v, bytes) else [_s64(v)]
        elif f == 8:
            name = v.decode()
        elif f == 9:
            raw = v
    dt = _DTYPES[dtype]
    if raw is not None:
        arr = np.frombuffer(raw, dtype=dt)
    else:
        arr = np.array(floats if floats else ints, dtype=dt)
    return name, arr.reshape(dims) if dims else arr.reshape(())


def _attribute(buf):
    name, val = "", None
    for f, v in _fields(buf):
        if f == 1:
            name = v.decode()
        elif f == 2:
            val = struct.unpack("<f", v)[0]
        elif f == 3:
            val = _s64(v)
        elif f == 4:
            val = v.decode()
        elif f == 5:
            val = _tensor(v)[1]
        elif f == 7:
            val = _packed(v, "f") if isinstance(v, bytes) else (val or []) + [struct.unpack("<f", v)[0]]
        elif f == 8:
            val = _packed(v, "q") if isinstance(v, bytes) else (val or []) + [_s64(v)]
    return name, val


class OnnxRunner:
    """只实现 PP-OCRv4 识别模型用到的那 25 个算子的极简 onnx 解释器（numpy + torch）。
    OpenCV 的 DNN 读不了这个模型里的动态 Reshape，onnxruntime 又和 numpy 2 冲突，所以自己跑。"""

    def __init__(self, path):
        graph = next(v for f, v in _fields(Path(path).read_bytes()) if f == 7)
        self.nodes, self.consts = [], {}
        for f, v in _fields(graph):
            if f == 5:
                name, arr = _tensor(v)
                self.consts[name] = arr
            elif f == 1:
                node = {"in": [], "out": [], "attr": {}}
                for ff, vv in _fields(v):
                    if ff == 1:
                        node["in"].append(vv.decode())
                    elif ff == 2:
                        node["out"].append(vv.decode())
                    elif ff == 4:
                        node["op"] = vv.decode()
                    elif ff == 5:
                        k, a = _attribute(vv)
                        node["attr"][k] = a
                if node["op"] == "Constant":
                    self.consts[node["out"][0]] = node["attr"]["value"]
                else:
                    self.nodes.append(node)
            elif f == 11:
                self.input = next(vv.decode() for ff, vv in _fields(v) if ff == 1)
            elif f == 12:
                self.output = next(vv.decode() for ff, vv in _fields(v) if ff == 1)

    def run(self, x):
        if not hasattr(self, "last_use"):
            # 每个中间结果最后一次被用到的位置：用完就释放，识别长行时内存会小很多
            self.last_use = {}
            for k, n in enumerate(self.nodes):
                for i in n["in"]:
                    self.last_use[i] = k
        env = dict(self.consts)
        env[self.input] = x
        for k, n in enumerate(self.nodes):
            args = [env[i] if i else None for i in n["in"]]
            env[n["out"][0]] = self._op(n["op"], args, n["attr"])
            for i in n["in"]:
                if self.last_use[i] == k and i not in self.consts:
                    env.pop(i, None)
        return env[self.output]

    @staticmethod
    def _op(op, a, at):
        import torch
        import torch.nn.functional as F

        if op == "Add":
            return a[0] + a[1]
        if op == "Sub":
            return a[0] - a[1]
        if op == "Mul":
            return a[0] * a[1]
        if op == "Div":
            return a[0] / a[1]
        if op == "Pow":
            return np.power(a[0], a[1]).astype(a[0].dtype)
        if op == "Sqrt":
            return np.sqrt(a[0])
        if op == "Sigmoid":
            return 1 / (1 + np.exp(-a[0]))
        if op == "Relu":
            return np.maximum(a[0], 0)
        if op == "HardSigmoid":
            return np.clip(at.get("alpha", 0.2) * a[0] + at.get("beta", 0.5), 0, 1).astype(a[0].dtype)
        if op == "Clip":
            lo = a[1] if len(a) > 1 and a[1] is not None else None
            hi = a[2] if len(a) > 2 and a[2] is not None else None
            return np.clip(a[0], lo, hi)
        if op == "Cast":
            return a[0].astype(_DTYPES[at["to"]])
        if op == "MatMul":
            return np.matmul(a[0], a[1])
        if op == "Softmax":
            e = np.exp(a[0] - a[0].max(at.get("axis", -1), keepdims=True))
            return e / e.sum(at.get("axis", -1), keepdims=True)
        if op == "Transpose":
            return a[0].transpose(at["perm"])
        if op == "Concat":
            return np.concatenate(a, axis=at["axis"])
        if op == "Shape":
            return np.array(a[0].shape, dtype=np.int64)
        if op == "Squeeze":
            return np.squeeze(a[0], axis=tuple(at["axes"]) if "axes" in at else (tuple(int(v) for v in a[1]) if len(a) > 1 else None))
        if op == "ReduceMean":
            return a[0].mean(axis=tuple(at["axes"]), keepdims=bool(at.get("keepdims", 1)))
        if op == "Reshape":
            shape = [int(v) for v in a[1]]
            shape = [a[0].shape[k] if v == 0 else v for k, v in enumerate(shape)]
            return a[0].reshape(shape)
        if op == "Slice":
            starts, ends = a[1], a[2]
            axes = a[3] if len(a) > 3 and a[3] is not None else range(len(starts))
            steps = a[4] if len(a) > 4 and a[4] is not None else [1] * len(starts)
            idx = [slice(None)] * a[0].ndim
            for s, e, ax, st in zip(starts, ends, axes, steps):
                idx[int(ax)] = slice(int(s), min(int(e), 2**62), int(st))
            return a[0][tuple(idx)]
        if op == "BatchNormalization":
            x, scale, b, mean, var = a[:5]
            shape = [1, -1] + [1] * (x.ndim - 2)
            return (x - mean.reshape(shape)) / np.sqrt(var.reshape(shape) + at.get("epsilon", 1e-5)) * scale.reshape(shape) + b.reshape(shape)
        if op == "GlobalAveragePool":
            return a[0].mean(axis=tuple(range(2, a[0].ndim)), keepdims=True)
        if op == "Conv":
            x = torch.from_numpy(np.ascontiguousarray(a[0]))
            pads = at.get("pads", [0, 0, 0, 0])
            if pads[0] != pads[2] or pads[1] != pads[3]:
                x = F.pad(x, (pads[1], pads[3], pads[0], pads[2]))
                pads = [0, 0, 0, 0]
            y = F.conv2d(
                x,
                torch.from_numpy(np.array(a[1])),
                torch.from_numpy(np.array(a[2])) if len(a) > 2 and a[2] is not None else None,
                stride=tuple(at.get("strides", [1, 1])),
                padding=(pads[0], pads[1]),
                dilation=tuple(at.get("dilations", [1, 1])),
                groups=at.get("group", 1),
            )
            return y.numpy()
        if op == "AveragePool":
            x = torch.from_numpy(np.ascontiguousarray(a[0]))
            pads = at.get("pads", [0, 0, 0, 0])
            y = F.avg_pool2d(
                x,
                tuple(at["kernel_shape"]),
                stride=tuple(at.get("strides", [1, 1])),
                padding=(pads[0], pads[1]),
                ceil_mode=bool(at.get("ceil_mode", 0)),
                count_include_pad=bool(at.get("count_include_pad", 0)),
            )
            return y.numpy()
        raise NotImplementedError(op)


@lru_cache(maxsize=1)
def _models():
    d = _model_dir()
    det = cv2.dnn.readNetFromONNX(str(d / "ch_PP-OCRv4_det_infer.onnx"))
    rec = OnnxRunner(d / "ch_PP-OCRv4_rec_infer.onnx")
    chars = ["blank"] + _character_list(d / "ch_PP-OCRv4_rec_infer.onnx") + [" "]
    return det, rec, chars


MEAN = np.array([0.5, 0.5, 0.5], dtype=np.float32)


def detect(img, max_side=1600, thresh=0.3, box_thresh=0.5, unclip=1.6):
    """文字行检测（DB）：返回原图坐标下的水平矩形 [x0, y0, x1, y1]。试卷都是横排文字，不处理旋转"""
    det, _, _ = _models()
    h, w = img.shape[:2]
    scale = min(1.0, max_side / max(h, w))
    nh, nw = max(32, round(h * scale / 32) * 32), max(32, round(w * scale / 32) * 32)
    x = cv2.resize(img, (nw, nh)).astype(np.float32) / 255.0
    x = ((x[:, :, ::-1] - MEAN) / MEAN).transpose(2, 0, 1)[None].copy()
    det.setInput(x)
    prob = det.forward()[0, 0]
    mask = (prob > thresh).astype(np.uint8)
    mask = cv2.dilate(mask, np.ones((2, 2), np.uint8))
    contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for c in contours[:1000]:
        (cx, cy), (rw, rh), _ = cv2.minAreaRect(c)
        if min(rw, rh) < 3:
            continue
        bx, by, bw, bh = cv2.boundingRect(c)
        score = float(prob[by : by + bh, bx : bx + bw][mask[by : by + bh, bx : bx + bw] > 0].mean())
        if score < box_thresh:
            continue
        # 按 DB 的做法外扩：距离 = 面积 × 比例 / 周长
        area, peri = bw * bh, 2 * (bw + bh)
        d = area * unclip / peri
        x0, y0, x1, y1 = bx - d, by - d, bx + bw + d, by + bh + d
        boxes.append([max(0, x0 / nw * w), max(0, y0 / nh * h), min(w, x1 / nw * w), min(h, y1 / nh * h), score])
    return boxes


def recognize(crop):
    _, rec, chars = _models()
    h, w = crop.shape[:2]
    nw = max(16, min(1600, int(math.ceil(48 * w / h))))
    x = cv2.resize(crop, (nw, 48)).astype(np.float32) / 255.0
    x = ((x[:, :, ::-1] - MEAN) / MEAN).transpose(2, 0, 1)[None].astype(np.float32)
    out = rec.run(x)[0]  # (T, 字表大小)
    idx = out.argmax(1)
    probs = out.max(1)
    text, last, scores = [], 0, []
    for k, i in enumerate(idx):
        if i != 0 and i != last:
            text.append(chars[i] if i < len(chars) else "")
            scores.append(float(probs[k]))
        last = i
    return "".join(text), (sum(scores) / len(scores) if scores else 0.0)


def merge_rows(boxes):
    """检测出的框有时把同一行切成几段；这里只做排序：从上到下，同一行内从左到右"""
    boxes = sorted(boxes, key=lambda b: (b[1] + b[3]) / 2)
    rows, cur = [], []
    for b in boxes:
        if cur and (b[1] + b[3]) / 2 - sum((c[1] + c[3]) / 2 for c in cur) / len(cur) > 0.6 * (b[3] - b[1]):
            rows.append(sorted(cur, key=lambda c: c[0]))
            cur = []
        cur.append(b)
    if cur:
        rows.append(sorted(cur, key=lambda c: c[0]))
    return [b for r in rows for b in r]


def ocr_page(page, dpi=200):
    """识别一页扫描件，返回文字行；坐标换算成 PDF 点"""
    pm = page.get_pixmap(dpi=dpi, alpha=False)
    img = np.frombuffer(pm.samples, dtype=np.uint8).reshape(pm.height, pm.width, 3)[:, :, ::-1].copy()
    k = 72 / dpi
    out = []
    for x0, y0, x1, y1, _ in merge_rows(detect(img)):
        crop = img[int(y0) : int(math.ceil(y1)), int(x0) : int(math.ceil(x1))]
        if crop.shape[0] < 6 or crop.shape[1] < 6:
            continue
        text, score = recognize(crop)
        if text.strip():
            out.append({"text": text, "x0": x0 * k, "y0": y0 * k, "x1": x1 * k, "y1": y1 * k, "score": score})
    return out


# ---------- 文字层和扫描页的统一接口 ----------

def get_words(page):
    """页面上的单词 [(x0,y0,x1,y1,词,...)]。有些 PDF 的文字层有两份（前一半是干净的，后一半是另一套识别结果，
    位置错开几个点），按位置分行后成了 "PartPart IIII"，找不到标题，单词表里每个词也出现两次。
    这种页面只留前一份：从某个块起位置回到页首、而且字母构成和前面差不多，就是第二份"""
    words = page.get_text("words")
    if len(words) < 60:
        return words
    top, cut = 0.0, None
    for i, w in enumerate(words):
        if i >= 30 and w[1] < top - 150 and w[5] != words[i - 1][5]:
            cut = i
            break
        top = max(top, w[1])
    if cut is None:
        return words
    from collections import Counter

    letters = lambda ws: Counter(c for w in ws for c in w[4].lower() if c.isalpha())
    ca, cb = letters(words[:cut]), letters(words[cut:])
    same = sum((ca & cb).values()) / max(1, max(sum(ca.values()), sum(cb.values())))
    return words[:cut] if same > 0.85 else words


def group_rows(words):
    """把 PyMuPDF 的单词按几何位置分成行（从上到下，行内从左到右）。
    有些 PDF 的文字层一个字一个块，PyMuPDF 自带的分行没法用"""
    words = sorted(words, key=lambda w: ((w[1] + w[3]) / 2, w[0]))
    rows, cur = [], []
    for w in words:
        if cur and abs((w[1] + w[3]) / 2 - sum((c[1] + c[3]) / 2 for c in cur) / len(cur)) > 0.5 * max(w[3] - w[1], 4):
            rows.append(sorted(cur, key=lambda c: c[0]))
            cur = []
        cur.append(w)
    if cur:
        rows.append(sorted(cur, key=lambda c: c[0]))
    return rows


def text_lines(page, gap=18):
    """文字层分行：行内有大空隙（左右两栏的选项）就切成两段"""
    out = []
    for row in group_rows(get_words(page)):
        seg = [row[0]]
        for w in row[1:]:
            if w[0] - seg[-1][2] > gap:
                out.append(_row(seg))
                seg = []
            seg.append(w)
        out.append(_row(seg))
    return out


def _row(ws):
    text = ""
    for k, w in enumerate(ws):
        if k and w[0] - ws[k - 1][2] > 0.18 * max(w[3] - w[1], 4):
            text += " "
        text += w[4]
    return {"text": text, "x0": min(w[0] for w in ws), "y0": min(w[1] for w in ws), "x1": max(w[2] for w in ws), "y1": max(w[3] for w in ws)}


def text_ok(lines):
    """文字层能不能用：乱码页的字母/汉字占比很低，或者英文里几乎没有 the/and/ing 这样的常见片段"""
    s = "".join(l["text"] for l in lines)
    chars = re.sub(r"\s", "", s)
    if len(chars) < 80:
        return False
    good = len(re.findall(r"[A-Za-z0-9一-鿿]", chars))
    if good / len(chars) < 0.75:
        return False
    letters = re.sub(r"[^a-z]", "", s.lower())
    if len(letters) >= 200 and sum(letters.count(t) for t in ("the", "and", "ing", "tion", "ent")) / len(letters) < 0.012:
        return False
    return True


def cache_path(pdf):
    return CACHE / (Path(pdf).stem + ".json")


def load_cache(pdf):
    p = cache_path(pdf)
    if p.exists():
        try:
            return {int(k): v for k, v in json.loads(p.read_text("utf-8")).items()}
        except ValueError:
            pass
    return {}


def save_cache(pdf, pages):
    CACHE.mkdir(parents=True, exist_ok=True)
    cache_path(pdf).write_text(json.dumps({str(k): v for k, v in sorted(pages.items())}, ensure_ascii=False, separators=(",", ":")), "utf-8")


def pages_need_ocr(pdf, doc=None):
    """这份 PDF 里文字层不能用、又还没识别过的页序号（从 0 开始）"""
    import fitz

    doc = doc or fitz.open(pdf)
    done = load_cache(pdf)
    return [i for i, page in enumerate(doc) if i not in done and not text_ok(text_lines(page))]


def _ocr_job(args):
    pdf, i = args
    import fitz

    fitz.TOOLS.mupdf_display_errors(False)
    doc = fitz.open(pdf)
    lines = ocr_page(doc[i])
    return pdf, i, [[l["text"], round(l["x0"], 1), round(l["y0"], 1), round(l["x1"], 1), round(l["y1"], 1), round(l["score"], 2)] for l in lines]


def run_ocr(jobs, workers=10, log=print):
    """jobs: [(pdf, 页序号)]；多进程识别，每识别完一份 PDF 就写缓存"""
    from concurrent.futures import ProcessPoolExecutor

    pending, total = {}, {}
    for pdf, i in jobs:
        total[pdf] = total.get(pdf, 0) + 1
    got = {pdf: load_cache(pdf) for pdf in total}
    done = 0
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_ocr_job, j) for j in jobs]
        from concurrent.futures import as_completed

        for fut in as_completed(futures):
            pdf, i, lines = fut.result()
            got[pdf][i] = lines
            pending[pdf] = pending.get(pdf, 0) + 1
            done += 1
            if pending[pdf] == total[pdf]:
                save_cache(pdf, got[pdf])
                log(f"  识别完成 {Path(pdf).name}（{done}/{len(jobs)} 页）")


def order_columns(lines, width):
    """双栏版面的阅读顺序：先左栏从上到下，再右栏；跨两栏的行（标题）把页面分成几段，每段内部分栏排。
    没有明显的栏间空白（大多数行跨过中线）就保持原来的从上到下顺序"""
    if len(lines) < 16:
        return lines
    best = None
    for g in range(int(width * 0.38), int(width * 0.62), 3):
        left = sum(1 for l in lines if l["x1"] <= g + 2)
        right = sum(1 for l in lines if l["x0"] >= g - 2)
        cross = len(lines) - left - right
        score = min(left, right) - 0.3 * cross
        if best is None or score > best[0]:
            best = (score, g, left, right, cross)
    score, g, left, right, cross = best
    if left < 6 or right < 6 or cross > 0.7 * len(lines):
        return lines
    out, band_l, band_r = [], [], []

    def flush():
        out.extend(sorted(band_l, key=lambda l: l["y0"]))
        out.extend(sorted(band_r, key=lambda l: l["y0"]))
        band_l.clear()
        band_r.clear()

    for l in sorted(lines, key=lambda l: l["y0"]):
        if l["x1"] <= g + 2:
            band_l.append(l)
        elif l["x0"] >= g - 2:
            band_r.append(l)
        else:
            flush()
            out.append(l)
    flush()
    return out


def pdf_page_lines(pdf, doc=None, gap=18):
    """一份 PDF 每页的文字行 [{text,x0,y0,x1,y1}]：文字层能用就用文字层，否则用缓存里的识别结果（没有就现场识别）"""
    import fitz

    doc = doc or fitz.open(pdf)
    need = pages_need_ocr(pdf, doc)
    if need:
        run_ocr([(str(pdf), i) for i in need], workers=min(10, len(need)))
    cache = load_cache(pdf)
    pages = []
    for i, page in enumerate(doc):
        if i in cache:
            lines = [{"text": t, "x0": a, "y0": b, "x1": c, "y1": d, "score": sc} for t, a, b, c, d, sc in cache[i]]
        else:
            lines = text_lines(page, gap)
        pages.append(order_columns(lines, page.rect.width))
    return pages
