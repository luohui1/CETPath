"""用 PaddleOCR 官方在线 API（飞桨星河社区，PP-OCRv5）识别解析 PDF 的扫描页、乱码页，结果写进 cet_ocr 的缓存。
本机 OCR（cet_ocr.py，手写的 onnx 解释器跑 PP-OCRv4）一页要 9 秒左右，几十页的整本扫描解析要跑很久；
在线 API 一份几十页的 PDF 几十秒就回来。写进 data/cache/cet-ocr/ 以后，import_cet.py 和 cet_answers.page_lines 直接用缓存，不再本机识别。

注意：要把解析 PDF 的那几页上传到百度的服务器。
令牌：环境变量 PADDLEOCR_ACCESS_TOKEN（在 https://aistudio.baidu.com/account/accessToken 复制），或 --token-file 指一个只有令牌的文本文件。

用法：
  python -I scripts/cet_ocr_paddle.py cet6-2017-06-2 cet6-2018-06-1     这几套的解析里要识别的页
  python -I scripts/cet_ocr_paddle.py --skipped                         data/cache/cet-import-dryrun.json 里跳过的所有套
  python -I scripts/cet_ocr_paddle.py --skipped --dry-run               只数要识别多少页
  python -I scripts/cet_ocr_paddle.py --papers cet6-2016-12-1           整份原卷识别（原卷文字层坏了的），import_cet.py 会改用识别结果
原始结果另存一份在 data/cache/cet-ocr-paddle/（以后换转换方式不用再调接口）。
"""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import fitz
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cet_answers  # noqa: E402
import cet_ocr  # noqa: E402
import import_cet  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data/cache/cet-ocr-paddle"
API = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"
MODEL = "PP-OCRv5"
CHUNK = 60  # 每个任务最多几页（接口上限 1000 页、本地上传 50MB；小一点出错时重做得少）
IN_FLIGHT = 8  # 同时排队的任务数


def token(path=None):
    if path:
        return Path(path).read_text("utf-8").strip()
    t = os.environ.get("PADDLEOCR_ACCESS_TOKEN", "").strip()
    if not t:
        sys.exit("没有令牌：设环境变量 PADDLEOCR_ACCESS_TOKEN，或用 --token-file")
    return t


def lines_of(result, page, img_w):
    """一页的识别结果 → cet_ocr 缓存的格式 [[文字, x0, y0, x1, y1, 分数]]，坐标换成 PDF 点，按行排好（同 cet_ocr.merge_rows）"""
    pr = result["prunedResult"]
    k = page.rect.width / img_w
    boxes = [[b[0] * k, b[1] * k, b[2] * k, b[3] * k, i] for i, b in enumerate(pr["rec_boxes"]) if pr["rec_texts"][i].strip()]
    out = []
    for x0, y0, x1, y1, i in cet_ocr.merge_rows(boxes):
        out.append([pr["rec_texts"][i], round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1), round(float(pr["rec_scores"][i]), 2)])
    return out


def submit(sess, pdf, pages):
    doc = fitz.open(pdf)
    sub = fitz.open()
    for i in pages:
        sub.insert_pdf(doc, from_page=i, to_page=i)
    payload = {"useDocOrientationClassify": False, "useDocUnwarping": False}
    for attempt in range(8):
        try:
            r = sess.post(API, data={"model": MODEL, "optionalPayload": json.dumps(payload)}, files={"file": ("doc.pdf", sub.tobytes(garbage=3, deflate=True), "application/pdf")}, timeout=300)
        except requests.RequestException:
            time.sleep(5 * (attempt + 1))  # 网络断了一下：等一会儿再交
            continue
        if r.status_code == 429 or (r.ok and r.json().get("code") in (10010, 12002)):
            time.sleep(5 * (attempt + 1))  # 太频繁或队列满：等一会儿再交
            continue
        r.raise_for_status()
        j = r.json()
        if j.get("code") != 0:
            raise RuntimeError(f"提交失败：{j}")
        return j["data"]["jobId"]
    raise RuntimeError("提交一直被限流")


def fetch(url):
    """结果是 JSONL：每行一个 {"result": {"ocrResults": [...], "dataInfo": {...}}}；按顺序拼成每页的 (识别结果, 图像宽)。
    结果地址是带签名的对象存储链接，不能再带 API 的 Authorization 头（会被拒）"""
    text = requests.get(url, timeout=300).text
    out = []
    for line in text.splitlines():
        if not line.strip():
            continue
        j = json.loads(line)
        if "result" not in j:
            raise RuntimeError(f"结果文件格式不对：{line[:200]}")
        res = j["result"]
        sizes = res.get("dataInfo", {}).get("pages", [])
        for j, o in enumerate(res["ocrResults"]):
            w = sizes[j]["width"] if j < len(sizes) else None
            out.append((o, w))
    return out, text


STORES = {"papers": "data/cache/cet-ocr-paper", "verify": "data/cache/cet-ocr-verify"}


def paper_cache(pdf, papers="papers"):
    return ROOT / STORES[papers] / (Path(pdf).stem + ".json")


def load_store(pdf, papers):
    if not papers:
        return cet_ocr.load_cache(pdf)
    p = paper_cache(pdf, papers)
    return {int(k): v for k, v in json.loads(p.read_text("utf-8")).items()} if p.exists() else {}


def save_store(pdf, pages, papers):
    if not papers:
        cet_ocr.save_cache(pdf, pages)
        return
    p = paper_cache(pdf, papers)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({str(k): v for k, v in sorted(pages.items())}, ensure_ascii=False, separators=(",", ":")), "utf-8")


def run(jobs, tok, log=print, papers=False):
    """jobs: {pdf: [页序号]}。分块提交、轮询、写缓存（papers=True 写原卷的识别缓存 data/cache/cet-ocr-paper/）"""
    sess = requests.Session()
    sess.headers["Authorization"] = "Bearer " + tok
    todo = [(pdf, pages[i : i + CHUNK]) for pdf, pages in jobs.items() for i in range(0, len(pages), CHUNK)]
    running, done_pages, total = {}, 0, sum(len(p) for _, p in todo)
    RAW.mkdir(parents=True, exist_ok=True)
    while todo or running:
        while todo and len(running) < IN_FLIGHT:
            pdf, pages = todo.pop(0)
            running[submit(sess, pdf, pages)] = (pdf, pages)
        time.sleep(3)
        for jid in list(running):
            try:
                r = sess.get(f"{API}/{jid}", timeout=60)
            except requests.RequestException:
                continue  # 下一轮再问
            if r.status_code == 429:
                continue
            data = r.json()["data"]
            if data["state"] == "failed":
                pdf, pages = running.pop(jid)
                log(f"  失败 {Path(pdf).name} 页 {pages[0] + 1}–{pages[-1] + 1}：{data.get('errorMsg')}")
                continue
            if data["state"] != "done":
                continue
            pdf, pages = running.pop(jid)
            try:
                got, raw = fetch(data["resultUrl"]["jsonUrl"])
            except Exception as e:  # 一块出错不影响别的块
                log(f"  取结果出错 {Path(pdf).name} 页 {pages[0] + 1}–{pages[-1] + 1}：{type(e).__name__}: {e}")
                continue
            if len(got) != len(pages):
                log(f"  页数对不上 {Path(pdf).name}：交了 {len(pages)} 页，回来 {len(got)} 页，不写缓存")
                continue
            doc = fitz.open(pdf)
            cache = load_store(pdf, papers)
            for i, (o, w) in zip(pages, got):
                cache[i] = lines_of(o, doc[i], w or doc[i].rect.width)
            save_store(pdf, cache, papers)
            (RAW / f"{Path(pdf).stem}_{pages[0]:03d}-{pages[-1]:03d}.jsonl").write_text(raw, "utf-8")
            done_pages += len(pages)
            log(f"  识别完成 {Path(pdf).name} 页 {pages[0] + 1}–{pages[-1] + 1}（{done_pages}/{total} 页）")
    return done_pages


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    fitz.TOOLS.mupdf_display_errors(False)
    ap = argparse.ArgumentParser(description="用 PaddleOCR 官方 API 识别解析 PDF 的扫描页、乱码页")
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--skipped", action="store_true", help="dry-run 结果里跳过的所有套")
    ap.add_argument("--papers", action="store_true", help="识别这几套的整份原卷（文字层坏了的原卷用），写 data/cache/cet-ocr-paper/")
    ap.add_argument("--verify", action="store_true", help="整份解析 PDF 都识别一遍，写 data/cache/cet-ocr-verify/（核对答案用，不影响导入）")
    ap.add_argument("--token-file")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    sets = import_cet.discover()
    ids = list(args.ids)
    if args.skipped:
        ids += [r["id"] for r in json.loads((ROOT / "data/cache/cet-import-dryrun.json").read_text("utf-8")) if r["status"] == "跳过"]
    jobs = {}
    for sid in dict.fromkeys(ids):
        info = sets.get(sid)
        if not info or "answers" not in info or "paper" not in info or info["shared"]:
            continue
        if args.papers or args.verify:
            src = info["paper"] if args.papers else info["answers"]
            done = load_store(src, "papers" if args.papers else "verify")
            need = [i for i in range(len(fitz.open(src))) if i not in done]
            if need:
                jobs[str(src)] = need
            continue
        need = cet_answers.pages_need_ocr(info["answers"])
        if need:
            jobs[str(info["answers"])] = need
    total = sum(len(v) for v in jobs.values())
    print(f"{len(jobs)} 份解析 PDF，共 {total} 页要识别")
    for pdf, pages in jobs.items():
        print(f"  {Path(pdf).name}: {len(pages)} 页")
    if args.dry_run or not jobs:
        return
    t = time.time()
    n = run(jobs, token(args.token_file), log=lambda m: print(f"[{time.time() - t:.0f}s]{m}", flush=True), papers="papers" if args.papers else "verify" if args.verify else False)
    print(f"完成 {n}/{total} 页，用时 {time.time() - t:.0f} 秒")


if __name__ == "__main__":
    main()
