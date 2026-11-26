#!/usr/bin/env python3
"""外刊：抓 VOA Learning English（公有领域）和 The Conversation（CC BY-ND）的新文章，整理成站里的格式。

  python3 scripts/fetch_articles.py [--out public/articles-data] [--per-feed 8] [--keep-days 60]

输出 out/index.json（列表）、out/<id>.json（全文）、out/audio/<id>.mp3（VOA 音频）。已抓过的不重抓。
The Conversation 的条件：原文不改、文首署名（作者和机构）并链接原文、保留统计像素、不收费。
VOA：公有领域，但署名 AP / Reuters 等通讯社的稿子不是，跳过。只用标准库。
"""
import argparse, html, json, re, sys, time, urllib.parse, urllib.request, zlib
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

UA = {"User-Agent": "Mozilla/5.0 (compatible; yingyu-zhidao-article-fetcher/1.0; +https://github.com/luohui1/CETPath)"}
VOA_FEEDS = [  # Learning English 里考研阅读常见话题的栏目：科技、健康与生活、美国社会文化
    "https://learningenglish.voanews.com/api/zmg_pl-vomx-tpeymtm",  # Science & Technology
    "https://learningenglish.voanews.com/api/zmmpql-vomx-tpey-_q",  # Health & Lifestyle
    "https://learningenglish.voanews.com/api/zbmroml-vomx-tpeqboo_",  # All About America
]
# 维基百科：从考研阅读常见话题的分类里挑文章，优先特色条目 / 优良条目
WIKI_API = "https://en.wikipedia.org/w/api.php"
WIKI_CATS = [
    "Cognitive biases", "Behavioral economics", "Educational psychology", "Learning", "Memory", "Sleep",
    "Nutrition", "Happiness", "Positive psychology", "Habits", "Artificial intelligence", "Machine learning",
    "Renewable energy", "Sustainability", "Urban planning", "Social media", "Consumer behaviour", "Personal finance",
    "Public health", "Ageing", "Employment", "Creativity", "Biodiversity", "Oceanography", "Space exploration",
]
WIKI_BADGES = "wikibase-badge-Q17437796|wikibase-badge-Q17437798"  # 特色条目 | 优良条目
# 有政治倾向的稿子不收：标题或话题里出现一次就跳过，正文前几段出现三次以上也跳过
POLITICS = re.compile(
    r"\b(politic\w*|election\w*|elector\w*|voters?|voting|ballot\w*|campaign\w*|parliament\w*|congress\w*|senat\w*|democra\w*|republican\w*|"
    r"president\w*|prime minister|government\w*|minister\w*|sanction\w*|tariff\w*|wars?|military|troops|missiles?|nuclear weapons?|protest\w*|"
    r"regime|communis\w*|Trump|Biden|Harris|Xi|Putin|Zelensky\w*|Netanyahu|Modi|Kremlin|White House|NATO|Taiwan\w*|Tibet\w*|Xinjiang|Hong Kong|"
    r"Ukrain\w*|Russia\w*|Israel\w*|Gaza|Hamas|Palestin\w*|Iran\w*|North Korea\w*|Beijing|CCP|Communist Party|refugee\w*|immigra\w*|asylum|"
    r"terror\w*|genocide|human rights|geopoliti\w*|diplomat\w*|China|Chinese|CPC|United Nations|UN|COP\d+|summits?|lobby\w*|spy|spies|espionage|"
    r"apartheid|coloni\w*|activis\w*|ideolog\w*|feminis\w*|gender\w*|abuse\w*|groom\w*|scandal\w*|police|court|lawsuit\w*|sovereign\w*|"
    r"Europe\w*|EU|Brexit|Africa\w*|Middle East|Cuba\w*|Venezuela\w*|Myanmar|Yemen|Syria\w*|Afghan\w*|Japan\w*|Korea\w*|India\w*|Pakistan\w*)\b",
    re.I,
)


def political(a):
    head = " ".join([a.get("title", ""), " ".join(a.get("topics") or []), a.get("summary", "")])
    body = " ".join(p["t"] for p in (a.get("paras") or [])[:4])
    return bool(POLITICS.search(head)) or len(POLITICS.findall(body)) >= 3


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
def wiki_get(**q):
    q.update(action="query", format="json", formatversion="2")
    time.sleep(1.5)  # 维基百科 API 限速，连着请求会 429
    return json.loads(get(WIKI_API + "?" + urllib.parse.urlencode(q)))


def wiki_paras(text, limit=700):
    """纯文本正文 → 段落：去掉小标题、列表碎句和参考文献之后的部分，取前 limit 词左右"""
    paras, words = [], 0
    for line in text.split("\n"):
        line = line.strip()
        if re.match(r"^=+\s*(See also|References|Notes|Further reading|External links|Bibliography|Sources)\s*=+$", line, re.I):
            break
        if not line or line.startswith("=") or len(line.split()) < 25:
            continue
        paras.append({"k": "p", "t": line})
        words += len(line.split())
        if words >= limit:
            break
    return paras


def wiki_items(cat, seen, day):
    pages = wiki_get(generator="categorymembers", gcmtitle=f"Category:{cat}", gcmtype="page", gcmlimit="200",
                     prop="pageprops", ppprop=WIKI_BADGES)["query"]["pages"]
    pages = [p for p in pages if f"wiki-{p['pageid']}" not in seen and not p["title"].startswith("List of")]
    # 优良/特色条目排前面；同档里按日期换着挑，每天不一样
    pages.sort(key=lambda p: (not p.get("pageprops"), zlib.crc32(f"{day}{p['pageid']}".encode())))
    for p in pages[:3]:
        d = wiki_get(pageids=p["pageid"], prop="extracts|info|revisions", explaintext="1", inprop="url", rvprop="timestamp")
        page = d["query"]["pages"][0]
        paras = wiki_paras(page.get("extract", ""))
        if sum(len(x["t"].split()) for x in paras) < 350:
            continue
        yield {
            "id": f"wiki-{page['pageid']}",
            "source": "wiki",
            "title": page["title"],
            "summary": re.split(r"(?<=[.!?])\s", paras[0]["t"], 1)[0][:200],
            "url": page["fullurl"],
            "published": page["revisions"][0]["timestamp"],
            "topics": [cat],
            "image": None,
            "author": "Wikipedia contributors",
            "license": "CC BY-SA 4.0（英文维基百科，节选前几节）",
        }, paras


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "public/articles-data"))
    ap.add_argument("--per-feed", type=int, default=8)
    ap.add_argument("--keep-days", type=int, default=60)
    ap.add_argument("--only", choices=["voa", "wiki"])
    ap.add_argument("--purge-politics", action="store_true", help="只清掉已收录里有政治倾向的文章")
    ap.add_argument("--per-level", type=int, default=5, help="每个等级（四级/六级/考研）每次最多新增几篇")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    idx_path = out / "index.json"
    index = {a["id"]: a for a in (json.loads(idx_path.read_text()) if idx_path.exists() else [])}
    new = 0
    if args.purge_politics:
        for aid in list(index):
            try:
                full = json.loads((out / f"{aid}.json").read_text())
            except (OSError, ValueError):
                continue
            if political(full):
                print("  - 删掉", aid, full.get("title", "")[:60])
                for f in (out / f"{aid}.json", out / "audio" / f"{aid}.mp3"):
                    f.unlink(missing_ok=True)
                del index[aid]
        idx_path.write_text(json.dumps(sorted(index.values(), key=lambda a: a["published"], reverse=True), ensure_ascii=False, separators=(",", ":")))
        print("剩", len(index), "篇")
        return

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    taken: dict[str, int] = {}

    def save(a):
        nonlocal new
        if political(a) or taken.get(a["level"], 0) >= args.per_level:
            if a.get("audio"):  # 这个等级今天已经够了，下好的音频也删掉
                (out / a["audio"]).unlink(missing_ok=True)
            return False
        taken[a["level"]] = taken.get(a["level"], 0) + 1
        a["fetched"] = now
        (out / f"{a['id']}.json").write_text(json.dumps(a, ensure_ascii=False, separators=(",", ":")))
        index[a["id"]] = {k: v for k, v in a.items() if k not in ("paras", "glossary", "keywords")}
        new += 1
        print("  +", a["id"], a["level"], a["words"], "词", a["title"][:60], flush=True)
        return True

    if args.only != "wiki":
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
        day = now[:10]
        for cat in sorted(WIKI_CATS, key=lambda c: zlib.crc32(f"{day}{c}".encode()))[: args.per_feed * 2]:
            try:
                for a, paras in wiki_items(cat, index, day):
                    if save(finish(a, paras)):
                        break
            except Exception as e:  # noqa: BLE001
                print("维基百科取不到：", cat, e, file=sys.stderr)

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
