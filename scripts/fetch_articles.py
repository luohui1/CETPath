#!/usr/bin/env python3
"""外刊：抓 VOA Learning English（公有领域）和 The Conversation（CC BY-ND）的新文章，整理成站里的格式。

  python3 scripts/fetch_articles.py [--out public/articles-data] [--per-feed 8] [--keep-days 60]

输出 out/index.json（列表）、out/<id>.json（全文）、out/audio/<id>.mp3（VOA 音频）。已抓过的不重抓。
The Conversation 的条件：原文不改、文首署名（作者和机构）并链接原文、保留统计像素、不收费。
VOA：公有领域，但署名 AP / Reuters 等通讯社的稿子不是，跳过。只用标准库。
"""
import argparse, html, json, re, sys, time, urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

UA = {"User-Agent": "Mozilla/5.0 (yingyu-zhidao article fetcher)"}
VOA_FEEDS = [  # Learning English 的几个文章栏目（rssfeeds 页上）
    "https://learningenglish.voanews.com/api/zbmroml-vomx-tpeqboo_",
    "https://learningenglish.voanews.com/api/zmg_pl-vomx-tpeymtm",
    "https://learningenglish.voanews.com/api/zmmpql-vomx-tpey-_q",
    "https://learningenglish.voanews.com/api/zyg__l-vomx-tpetmty",
    "https://learningenglish.voanews.com/api/zoroqql-vomx-tpeptpqq",
    "https://learningenglish.voanews.com/api/zmypyl-vomx-tpeyry_",
    "https://learningenglish.voanews.com/api/zyk-il-vomx-tpetpqqm",
    "https://learningenglish.voanews.com/api/z-viqql-vomx-tpero_qq",
]
TC_FEEDS = {"global": "https://theconversation.com/global/articles.atom"}
WIRE = re.compile(r"\bAssociated Press\b|\(AP\)|\bAP Photo\b|\bReuters\b|\bAFP\b|\bAgence France-Presse\b")
ROOT = Path(__file__).resolve().parent.parent


def get(url, binary=False, tries=3):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                b = r.read()
                return b if binary else b.decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            if k == tries - 1:
                raise
            time.sleep(2 + k * 3)


def text_of(frag):
    t = re.sub(r"<br\s*/?>", " ", frag)
    t = re.sub(r"<[^>]+>", "", t)
    return re.sub(r"\s+", " ", html.unescape(t)).strip()


def blocks(body):
    """HTML 正文 → [{k, t}]：p 段落、h 小标题、q 引用；图片、视频、嵌入一律不要"""
    body = re.sub(r"<(figure|iframe|script|style|aside|table)\b.*?</\1>", "", body, flags=re.S | re.I)
    out = []
    for m in re.finditer(r"<(p|h2|h3|blockquote|li)\b([^>]*)>(.*?)</\1>", body, re.S | re.I):
        tag, attrs, inner = m.group(1).lower(), m.group(2), m.group(3)
        if tag == "li" and re.search(r"<p\b", inner, re.I):
            out += blocks(inner)  # 列表项里套着段落：按段落取
            continue
        t = text_of(inner)
        if not t:
            continue
        k = "h" if tag in ("h2", "h3") else "q" if tag == "blockquote" else "fine" if "fine-print" in attrs else "p"
        out.append({"k": k, "t": t})
    return out


# ---------- 难度：按四六级词表估 ----------
def load_levels():
    lemma = json.loads((ROOT / "public/dict/lemma.json").read_text()) if (ROOT / "public/dict/lemma.json").exists() else {}
    lv = {}
    for name, n in (("ky", 3), ("cet6", 2), ("cet4", 1)):
        p = ROOT / f"public/dict/books/{name}.json"
        if p.exists():
            for e in json.loads(p.read_text()):
                lv[e["w"].lower()] = n
    return lemma, lv


LEMMA, LEVELS = load_levels()


def level_of(paras):
    words = [w.lower() for p in paras if p["k"] != "fine" for w in re.findall(r"[A-Za-z]+(?:'[a-z]+)?", p["t"])]
    if not words:
        return "四级", 0, []
    hard = {}
    for w in words:
        if len(w) < 4:
            continue
        base = LEMMA.get(w, w)
        n = LEVELS.get(base, LEVELS.get(w))
        if n and n >= 2:
            hard[base] = n
    above4 = sum(1 for w in words if LEVELS.get(LEMMA.get(w, w), 0) >= 2) / len(words)
    level = "四级" if above4 < 0.035 else "六级" if above4 < 0.07 else "考研"
    keys = sorted(hard, key=lambda w: (-hard[w], w))[:30]
    return level, len(words), keys


def finish(a, paras):
    a["paras"] = paras
    a["level"], a["words"], a["keywords"] = level_of(paras)
    a["minutes"] = max(1, round(a["words"] / 160))
    return a


# ---------- VOA ----------
def voa_feeds():
    return VOA_FEEDS


def voa_items(feed):
    x = get(feed)
    chan = text_of(re.search(r"<title>(.*?)</title>", x, re.S).group(1)).replace(" - Voice of America", "")
    for it in re.findall(r"<item>(.*?)</item>", x, re.S):
        g = lambda t: (re.search(rf"<{t}>(.*?)</{t}>", it, re.S) or [None, ""])[1]  # noqa: E731
        link = text_of(g("link"))
        m = re.search(r"/(\d+)\.html", link)
        if not m:
            continue
        img = re.search(r'<enclosure url="([^"]+)"[^>]*type="image', it)
        yield {
            "id": f"voa-{m.group(1)}",
            "source": "voa",
            "title": text_of(g("title")),
            "summary": text_of(g("description")),
            "url": link,
            "published": parsedate_to_datetime(text_of(g("pubDate"))).astimezone(timezone.utc).isoformat(),
            "topics": sorted({text_of(c) for c in re.findall(r"<category>(.*?)</category>", it)} | {chan}),
            "image": img.group(1) if img else None,
        }


def voa_article(a, out):
    page = get(a["url"])
    i = page.find('<div class="wsw">')
    if i < 0:
        return None
    body = page[i:]
    cut = [body.find(s) for s in ('<div class="c-author', "Quiz - ", ">Related<", 'class="share--box', 'id="comments"') if body.find(s) > 0]
    body = body[: min(cut)] if cut else body[:80000]
    gloss = []
    g = re.search(r"Words in This Story(?:\s*</(?:strong|b|em|span)>)*\s*</h2>(.*)", body, re.S)
    if g:
        body = body[: g.start()]
        for p in re.findall(r"<p[^>]*>(.*?)</p>", g.group(1), re.S):
            t = text_of(p)
            m = re.match(r"(.+?)\s+[–—-]\s*(.+)", t)
            if m:
                gloss.append({"w": m.group(1).strip(), "d": m.group(2).strip()})
    paras = [p for p in blocks(body) if p["t"] not in ("No media source currently available",) and not p["t"].startswith("Quiz -")]
    paras = [p for p in paras if p["t"] not in ("Load more", "Share", "Print")]
    if "Day in Photos" in " ".join(a["topics"]) or sum(len(p["t"].split()) for p in paras) < 150:
        return None  # 图集、太短的不要
    if WIRE.search(" ".join(p["t"] for p in paras)) or WIRE.search(page[page.find("<title>"): page.find("<title>") + 400]):
        print("  跳过（通讯社稿）", a["title"], file=sys.stderr)
        return None
    # 结尾署名一行（I'm Jill Robbins. / ___ wrote this story...）留着当作者
    a["author"] = next((p["t"] for p in reversed(paras) if re.search(r"(wrote|adapted|reported) (this|the) story", p["t"])), "VOA Learning English")
    a["license"] = "公有领域（VOA，美国政府作品）"
    a["glossary"] = gloss
    mp3 = sorted(set(re.findall(r"https://[^\"' ]+?\.mp3", page)), key=lambda u: ("_hq" in u, len(u)))
    if mp3:
        try:
            (out / "audio").mkdir(parents=True, exist_ok=True)
            (out / "audio" / f"{a['id']}.mp3").write_bytes(get(mp3[0], binary=True))
            a["audio"] = f"audio/{a['id']}.mp3"
        except Exception as e:  # noqa: BLE001
            print("  音频没下下来：", e, file=sys.stderr)
    return finish(a, paras)


# ---------- The Conversation ----------
def tc_items(feed):
    x = get(feed)
    for e in re.findall(r"<entry>(.*?)</entry>", x, re.S):
        g = lambda t: (re.search(rf"<{t}[^>]*>(.*?)</{t}>", e, re.S) or [None, ""])[1]  # noqa: E731
        aid = re.search(r"article/(\d+)", g("id"))
        content = html.unescape(g("content"))
        if not aid or not content:
            continue
        link = re.search(r'<link rel="alternate" type="text/html" href="([^"]+)"', e)
        authors = [text_of(n) for n in re.findall(r"<author>\s*<name>(.*?)</name>", e, re.S)]
        pixel = re.search(r'<img src="(https://counter\.theconversation\.com/[^"]+)"', content)
        img = re.search(r'<img src="(https://images\.theconversation\.com/[^"]+)"', content)
        a = {
            "id": f"tc-{aid.group(1)}",
            "source": "tc",
            "title": text_of(g("title")),
            "summary": text_of(g("summary")),
            "url": link.group(1) if link else "https://theconversation.com",
            "published": text_of(g("published")),
            "topics": [],
            "image": html.unescape(img.group(1)) if img else None,
            "author": "；".join(authors),
            "license": "CC BY-ND 4.0（The Conversation，原文未作改动）",
            "pixel": pixel.group(1) if pixel else None,
        }
        yield a, content


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "public/articles-data"))
    ap.add_argument("--per-feed", type=int, default=8)
    ap.add_argument("--keep-days", type=int, default=60)
    ap.add_argument("--only", choices=["voa", "tc"])
    ap.add_argument("--per-level", type=int, default=5, help="每个等级（四级/六级/考研）每次最多新增几篇")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    idx_path = out / "index.json"
    index = {a["id"]: a for a in (json.loads(idx_path.read_text()) if idx_path.exists() else [])}
    new = 0

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    taken: dict[str, int] = {}

    def save(a):
        nonlocal new
        if taken.get(a["level"], 0) >= args.per_level:
            return
        taken[a["level"]] = taken.get(a["level"], 0) + 1
        a["fetched"] = now
        (out / f"{a['id']}.json").write_text(json.dumps(a, ensure_ascii=False, separators=(",", ":")))
        index[a["id"]] = {k: v for k, v in a.items() if k not in ("paras", "glossary", "keywords")}
        new += 1
        print("  +", a["id"], a["level"], a["words"], "词", a["title"][:60], flush=True)

    if args.only != "tc":
        for feed in voa_feeds():
            try:
                items = list(voa_items(feed))[: args.per_feed]
            except Exception as e:  # noqa: BLE001
                print("VOA 栏目取不到：", feed, e, file=sys.stderr)
                continue
            for a in items:
                if a["id"] in index:
                    index[a["id"]]["topics"] = sorted(set(index[a["id"]]["topics"]) | set(a["topics"]))
                    continue
                try:
                    full = voa_article(a, out)
                except Exception as e:  # noqa: BLE001
                    print("  文章取不到：", a["url"], e, file=sys.stderr)
                    continue
                if full:
                    save(full)
    if args.only != "voa":
        for feed in TC_FEEDS.values():
            try:
                for a, content in list(tc_items(feed))[: args.per_feed * 3]:
                    if a["id"] not in index:
                        full = finish(a, blocks(content))
                        if full["words"] >= 150:
                            save(full)
            except Exception as e:  # noqa: BLE001
                print("The Conversation 取不到：", e, file=sys.stderr)

    # 抓来超过 keep-days 天的删掉（列表、全文、音频）。按抓取时间算：VOA 的栏目里常有几年前的旧文
    cutoff = datetime.now(timezone.utc) - timedelta(days=args.keep_days)
    for aid, a in list(index.items()):
        a.setdefault("fetched", now)
        if datetime.fromisoformat(a["fetched"]) < cutoff:
            del index[aid]
            for p in (out / f"{aid}.json", out / "audio" / f"{aid}.mp3"):
                p.unlink(missing_ok=True)
    lst = sorted(index.values(), key=lambda a: a["published"], reverse=True)
    idx_path.write_text(json.dumps(lst, ensure_ascii=False, separators=(",", ":")))
    print(f"新增 {new} 篇，共 {len(lst)} 篇")


if __name__ == "__main__":
    main()
