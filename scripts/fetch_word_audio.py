"""
把词书里所有单词的真人发音提前下载到 public/audio/words/{us,uk}/<slug>.mp3，应用离线也能播。
来源：有道词典的发音接口（dict.youdao.com/dictvoice，type=2 美音、type=1 英音）。
这是非官方接口：本机开发和自用可以，正式对外发布前要换成有授权的发音来源。

用法：
  python scripts/fetch_word_audio.py                 # 下载全部（已下载的跳过，可以断点续传）
  python scripts/fetch_word_audio.py --limit 10      # 先试 10 个词
  python scripts/fetch_word_audio.py --accent us     # 只下美音

下载完会写 public/audio/words/index.json：每种口音有哪些词，应用据此决定播文件还是退回系统语音。
"""

import argparse
import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOOKS = ["cet4", "cet6", "ky"]
OUT = os.path.join(ROOT, "public", "audio", "words")
ACCENTS = {"us": 2, "uk": 1}


def slug(word: str) -> str:
    """文件名：小写，字母数字以外的字符换成 _（和 src/lib/speech.ts 里的 wordSlug 一致）"""
    return re.sub(r"[^a-z0-9]+", "_", word.lower()).strip("_")


def book_words() -> list[str]:
    seen, words = set(), []
    for b in BOOKS:
        with io.open(os.path.join(ROOT, "public", "dict", "books", f"{b}.json"), encoding="utf-8") as f:
            for e in json.load(f):
                w = e["w"].strip().lower()
                if w and w not in seen:
                    seen.add(w)
                    words.append(w)
    return words


def to_mp3(path: str):
    """统一成 64kbps 单声道 mp3：接口有时直接给 WAV（一个词一百多 KB），有的 mp3 码率高到 300k，单词用不着"""
    with open(path, "rb") as f:
        wav = f.read(4) == b"RIFF"
    if not wav and os.path.getsize(path) <= 24_000:
        return
    src = path[:-4] + (".wav" if wav else ".src.mp3")
    os.replace(path, src)
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-ac", "1", "-b:a", "64k", path], capture_output=True)
    # 转不了、或者转完反而更大，就留原样，浏览器也能播
    if r.returncode == 0 and (wav or os.path.getsize(path) < os.path.getsize(src)):
        os.remove(src)
    else:
        os.replace(src, path)


def fetch(word: str, accent: str) -> tuple[str, str, int]:
    """返回 (词, 状态, 字节数)；状态是 ok / skip / empty / error:..."""
    path = os.path.join(OUT, accent, slug(word) + ".mp3")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        to_mp3(path)
        return word, "skip", os.path.getsize(path)
    url = f"https://dict.youdao.com/dictvoice?audio={urllib.parse.quote(word)}&type={ACCENTS[accent]}"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=15) as r:
                data = r.read()
                ctype = r.headers.get("Content-Type", "")
            # 正常是 audio/mpeg；返回网页或空文件说明被拦了或者没有这个词
            if not data or "audio" not in ctype:
                return word, f"empty:{ctype}", 0
            tmp = path + ".part"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
            to_mp3(path)
            return word, "ok", os.path.getsize(path)
        except urllib.error.HTTPError as e:
            if e.code in (403, 429):
                # 被限流或拒绝：不绕过，直接停
                return word, f"blocked:{e.code}", 0
            err = f"error:{e.code}"
        except Exception as e:  # 网络抖动，重试两次
            err = f"error:{type(e).__name__}"
        time.sleep(1.5 * (attempt + 1))
    return word, err, 0


def write_index():
    index = {}
    for accent in ACCENTS:
        d = os.path.join(OUT, accent)
        if os.path.isdir(d):
            index[accent] = sorted(f[:-4] for f in os.listdir(d) if f.endswith(".mp3") and os.path.getsize(os.path.join(d, f)) > 0)
    with io.open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, separators=(",", ":"))
    return index


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--accent", choices=list(ACCENTS), action="append")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    words = book_words()
    if args.limit:
        words = words[: args.limit]
    accents = args.accent or list(ACCENTS)
    for a in accents:
        os.makedirs(os.path.join(OUT, a), exist_ok=True)

    for accent in accents:
        stats = {"ok": 0, "skip": 0, "bad": 0, "bytes": 0}
        failed = []
        started = time.time()
        with ThreadPoolExecutor(args.workers) as pool:
            for i, (word, status, size) in enumerate(pool.map(lambda w: fetch(w, accent), words), 1):
                if status in ("ok", "skip"):
                    stats[status] += 1
                    stats["bytes"] += size
                else:
                    stats["bad"] += 1
                    failed.append((word, status))
                    if status.startswith("blocked"):
                        print(f"[{accent}] 被拒绝（{status}），停止下载；已下载的保留", flush=True)
                        pool.shutdown(wait=False, cancel_futures=True)
                        break
                if i % 500 == 0 or i == len(words):
                    print(f"[{accent}] {i}/{len(words)} 新下载 {stats['ok']} 已有 {stats['skip']} 失败 {stats['bad']} 共 {stats['bytes'] / 1e6:.1f} MB，用时 {time.time() - started:.0f}s", flush=True)
        if failed:
            print(f"[{accent}] 失败 {len(failed)} 个，例如：{failed[:10]}", flush=True)

    index = write_index()
    print("index:", {a: len(v) for a, v in index.items()})


if __name__ == "__main__":
    sys.exit(main())
