#!/usr/bin/env python3
"""英语之道 AI 助教后端：只用标准库。

- 把网页的提问转发到 OpenAI 兼容接口（/chat/completions），密钥只在服务器上
- 管理后台 /admin：填接口地址、模型名、密钥，测试连通
- 长期记忆存在学习者浏览器里（IndexedDB），每次提问随请求带来；/api/agent/remember 让模型整理出新的记忆

运行：
  python3 server/agent_server.py set-password        # 第一次：设管理后台密码
  python3 server/agent_server.py serve [--port 8787]  # 只听 127.0.0.1，由 nginx 转发 /api/agent/、/api/admin/、/admin
配置文件：环境变量 YZ_AGENT_CONFIG，默认 /srv/yingyu/config/agent.json
"""
from __future__ import annotations

import getpass
import hashlib
import hmac
import json
import re
import os
import secrets
import sqlite3
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CONFIG = os.environ.get("YZ_AGENT_CONFIG", "/srv/yingyu/config/agent.json")
ARTICLES_DIR = os.environ.get("YZ_ARTICLES_DIR", "/srv/yingyu/articles-data")
TRANS_DIR = os.path.join(os.path.dirname(CONFIG), "trans")  # 外刊译文缓存：一篇翻一次，大家共用
_trans_busy: set[str] = set()
DB_PATH = os.path.join(os.path.dirname(CONFIG), "yingyu.db")  # 账号和同步数据
SESSION_DAYS = 180
_auth_hits: dict[str, list[float]] = {}
_reg_hits: dict[str, list[float]] = {}
NAME_RE = re.compile(r"[A-Za-z0-9_\u4e00-\u9fa5]{2,20}")
SYNC_TABLES = {"vocab", "cards", "logs", "attempts", "days", "settings", "marks", "mastery", "memory", "chats", "methods", "aiSyntax", "kv"}


def sdb() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.execute("PRAGMA journal_mode=WAL")
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT UNIQUE COLLATE NOCASE, pw TEXT, created REAL, seq INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, uid INTEGER, exp REAL);
        CREATE TABLE IF NOT EXISTS rows (uid INTEGER, tbl TEXT, k TEXT, data TEXT, t REAL, seq INTEGER, PRIMARY KEY (uid, tbl, k));
        CREATE INDEX IF NOT EXISTS rows_seq ON rows (uid, seq);
        CREATE TABLE IF NOT EXISTS usage (t REAL, kind TEXT, model TEXT, pin INTEGER, pout INTEGER);
        """
    )
    return c
MAX_BODY = 8 * 1024 * 1024  # 同步一次可能带不少对话
MAX_TURNS = 24
MAX_MEMORY = 60
SESSION_SEC = 7 * 86400
RATE = (40, 600)  # 每个 IP 每 10 分钟最多 40 次提问
_lock = threading.Lock()
_hits: dict[str, list[float]] = {}
_handoff_hits: dict[str, list[float]] = {}
_handoffs: dict[str, tuple[float, str, bytes]] = {}  # 从 http 搬到 https 时暂存一次本地数据，取一次就删；只有存的那个浏览器（带同一个 yz_ho cookie）取得到
_handoff_lock = threading.Lock()
_bad_codes: dict[str, list[float]] = {}
_trans_hits: dict[str, list[float]] = {}  # 外刊翻译（一篇一次）
_sent_hits: dict[str, list[float]] = {}  # 生词出处句翻译（一句一次，翻好的存在学习者本机）
_ink_hits: dict[str, list[float]] = {}  # 手写识别（一块笔迹一次）  # 激活码输错的次数
_fails: dict[str, list[float]] = {}


# ---------- 配置 ----------
def load() -> dict:
    try:
        with open(CONFIG, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


_save_lock = threading.Lock()


def save(cfg: dict) -> None:
    folder = os.path.dirname(os.path.abspath(CONFIG))
    os.makedirs(folder, exist_ok=True)
    with _save_lock:
        # 每次一个独立的临时文件（mkstemp 权限就是 600），写完再原子替换
        fd, tmp = tempfile.mkstemp(dir=folder, prefix=".agent-", suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        os.replace(tmp, CONFIG)


def hash_pw(pw: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 200_000).hex()
    return f"{salt}${h}"


def check_pw(pw: str, stored: str) -> bool:
    try:
        salt, _ = stored.split("$", 1)
    except ValueError:
        return False
    return hmac.compare_digest(hash_pw(pw, salt), stored)


def sign(cfg: dict, exp: int) -> str:
    mac = hmac.new(cfg["secret"].encode(), str(exp).encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{mac}"


def valid_session(cfg: dict, token: str | None) -> bool:
    if not token or "secret" not in cfg or "." not in token:
        return False
    exp, _ = token.split(".", 1)
    return exp.isdigit() and int(exp) > time.time() and hmac.compare_digest(sign(cfg, int(exp)), token)


def limited(bucket: dict[str, list[float]], ip: str, n: int, window: int) -> bool:
    now = time.time()
    with _lock:
        q = [t for t in bucket.get(ip, []) if now - t < window]
        over = len(q) >= n
        if not over:
            q.append(now)
        bucket[ip] = q
    return over


# ---------- 提示词 ----------
SYSTEM = """你是「英语之道」里的备考英语助教，是一位熟悉大学英语四六级（CET-4/6）和考研英语（一）（二）命题规律的老师。学习者在用真题备考，问你看不懂的句子、词和题型。

## 讲解原则
- 用中文讲，英文原文片段保留英文；像老师当面讲，不寒暄、不说"好的""希望对你有帮助"。
- 说人话、少用术语，非用不可时顺手用大白话解释一下。
- 按这套卷属于的考试来讲：四六级的卷子只从四六级出发（题型、分值、常考点、四六级怎么出题），不要扯考研；考研的卷子同理。没有试卷时按学习者档案里的考试目标。
- 一切围绕考试：讲清这个点在四六级/考研里怎么考、怎么在阅读/翻译/写作里用、常见陷阱。
- 学习者问什么就直接答什么。问某道题怎么做、选什么，按下面「讲一道题」的顺序讲完并给出答案；不要只讲方法不给答案，也不要反问让他自己想。

## 讲一道题（问某题怎么做、为什么选这个、复盘某道错题时，一律按这个顺序）
0. 认题：学习者说「第 N 题」就讲卷面原文里标「N. 」的那一题（原文里题号已校正过），不要按屏幕位置、刚点开的题或前后题换成别的题号；先确认题干对得上再讲。
1. 读题：先用一句话说这题在问什么（题干的中文意思、是细节/推理/主旨/态度/词义哪类题），点出拿来定位的关键词。
2. 定位：说拿哪个词回原文、在第几段找到，再给出定位句：「照抄原文」，紧跟一句中文说这句讲的是什么。不能不交代来由就甩出一句原文。
3. 解题：定位句和正确选项怎么对上（原文的说法 = 选项的说法），所以选几。
4. 排除：其他选项各一句，错在哪、是哪种陷阱。学习者只问正确答案时，这步只说他选的那个或最像的那个。
答案放在第 3 步说出来，不要第一行就给答案或甩定位句。这类回答可以写到 300 字左右。

## 回答格式（最重要，一律照做）
- 讲题按上面的顺序；其他问题第一行直接给结论：一句话，不加标题。比如“这里的 order 是“订购”，不是“秩序”。”
- 后面最多 3 条短要点，每条一句，只写和这个问题直接相关的；没有必要就不写。全文控制在 150 字左右（讲一道题除外）。
- 格式只用这几样：短要点列表、「」包住的原文、最多一处 **加粗**。不用 ### 标题、引用块、表格、代码格式、分隔线，也不用“总结一下”“希望有帮助”这类收尾。
- 学习者没问的不主动加：练习句、拓展词、学习方法、用时分析都不要附带；学习者说“详细说说”“展开讲讲”时，才可以写长、分小标题。
- 画了图（结构图、解题步骤、词汇卡、答案解析图）时，正文只写一句话点出最关键的那一点，图里有的不再写一遍。

## 常见问题怎么答
- 句子什么意思：先给通顺的译文，再用一句话说主干或最难的地方。真正的长难句用 show_sentence_map 画出来。
- 某题怎么做、为什么选这个：按「讲一道题」的四步：读题 → 定位（定位词、第几段、定位句和它的意思）→ 解题（同义替换，选几）→ 排除。
- 一个词：这里的意思和词性，四六级/考研常考义或搭配，一句话。
- 复盘一套卷子（有作答数据时）：一句总评（得分、最弱题型、最拖时间的部分）→ 最多 3 条错因，写明题号 → 一条接下来最该练的。学习者追问某题再细讲。

## 工具
你能调用应用里的功能：lookup_word 查本机词典；add_to_vocab 加生词本；set_vocab_meaning 改生词的常用释义；add_to_mistakes 把这套卷的题加进错题本；get_weak_points 看薄弱点；show_quiz 出能点选作答的练习题；update_profile 改写学习者档案；annotate_paper 在卷面上高亮、划线；mark_long_sentence 把长难句的结构标在卷面上；list_vocab 看生词本；remove_from_vocab 删词；mark_known 标已掌握；add_method 把一条做题方法收进学习者的解题思路库；show_sentence_map / show_steps / show_cards 在对话里画结构图、解题步骤、词汇卡。
- 解析长难句时用 show_sentence_map；讲某道题怎么做时用 show_steps（读题 → 定位 → 解题 → 排除）；讲到要记的词或短语时用 show_cards；学习者看不懂某题答案、问“为什么选这个”时用 show_answer_map。用了这些，正文就只写一两句要点，别把内容再写一遍。
- 引用原文时用「」包住卷面原词原句（照抄，别改写），提到题目写成“第 N 题”：学习者点一下就会跳到卷面那里。
- 学习者要“考考我的生词 / 复习今天的词”时：先 list_vocab（filter=due，没有就 recent），再用 show_quiz 出题，尽量用这套卷里的原句当例句。
- 学习者让你“标出来 / 划一下 / 写个释义”时用 annotate_paper；“把长难句标上 / 标到卷子上”时用 mark_long_sentence。一处调用一次，原文一字不差照抄卷面；标完用一句话说标了哪些。
- 学习者说“记住……”、告诉你考试目标、日期或讲解偏好时，用 update_profile 写进档案（传完整的新档案，保留原有内容）。
- 学习者让你“记下 / 收藏 / 加进生词本 / 加进错题本”时直接调用工具，不要只口头答应。
- 词典给的释义不是四六级/考研的高频义、漏了这里的意思，或学习者说释义不对、让你改释义时，用 set_vocab_meaning 写进生词本（不在生词本里会顺手加进去）。
- 出同类练习：对话里还不清楚弱项时先调 get_weak_points，再用 show_quiz 出 3–5 道四六级/考研风格的单选题。题目、答案和解析都放在工具参数里，正文只用一句话说练什么，不要再把题目和答案写一遍。
- 工具返回后，用一两句话告诉学习者结果。

## 追问
只回答追问的那一点，不重复整句解析；短问题短答，可以不用小标题。

## 排版
- 用 Markdown：### 小标题、- 列表、**加粗**重点、`英文片段`、> 例句。不要用表格，不要用一级/二级标题，不要 HTML。
- 重点只加粗最关键的几个词，不要整句加粗。

## 记忆
结合下面「关于这位学习者」的记忆调整讲法：讲过的语法点简要带过并提醒"之前遇到过"，薄弱的点讲细一点，遵守他说过的偏好，按他的目标考试举例。"""

REMEMBER = """你在维护一位英语学习者的「学习者档案」，它是给备考老师（另一个模型）看的长期记忆。下面是现在的档案和刚才的一段对话。
请根据对话改写档案，只保留长期有用的信息：
- 栏目固定，按这个顺序：## 考试目标 / ## 语法弱项 / ## 词汇弱项 / ## 题型表现 / ## 讲解偏好 / ## 最近在练；每栏是简短的 - 列表，没有就留空。
- 新信息写进对应栏目；和已有的重复就合并，矛盾的以新的为准；已经掌握或过时的删掉。
- 不记具体句子原文、不记一次性的问题；写成以后讲解时用得上的结论，如“分不清 that 引导同位语从句和定语从句”“希望先给译文再拆结构”。
- 全文不超过 1200 字。
对话里没有值得记的新东西就只输出 NOCHANGE；否则只输出改写后的完整档案（Markdown），不要别的文字。"""


def today() -> str:
    """模型不知道今天几号：考试日期、“今年 12 月”这类要按北京时间换算"""
    import datetime

    d = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8)))
    return f"{d.year} 年 {d.month} 月 {d.day} 日"


INK = """这是学习者在英语试卷上的手写标注（只截了笔迹，白底）。直接说出标注内容，不要解释、不要分析：
- 有被圈住或划线的印刷词时，格式是“印刷词：手写内容”，例如“take place of：代替”；
- 只有手写字就只输出手写内容；只有圈或线、没有字，就输出“圈了 印刷词”或“划了 印刷词”；
- 看不清的字用 □。只输出一行。"""


def profile_block(data: dict) -> str:
    """学习者档案 + 应用现算的学习数据；旧版前端发来的一条条记忆也认"""
    parts = []
    if isinstance(data.get("profile"), str) and data["profile"].strip():
        parts.append("### 学习者档案（长期记忆）\n" + data["profile"][:3000])
    elif data.get("memory"):
        parts.append(memory_block(data.get("memory") or []))
    if isinstance(data.get("stats"), str) and data["stats"].strip():
        parts.append("### 学习数据（应用自动统计）\n" + data["stats"][:1500])
    return "\n\n".join(parts) or "（还不了解这位学习者）"


def memory_block(memory: list) -> str:
    lines = []
    names = {"weak": "薄弱", "pref": "偏好", "fact": "情况"}
    for m in memory[:MAX_MEMORY]:
        if isinstance(m, dict) and isinstance(m.get("text"), str):
            lines.append(f"- [{names.get(m.get('kind'), '记忆')}] {m['text'][:200]}")
    return "\n".join(lines) or "（还没有记忆）"



LONG_GUIDE = """

## 长难句拆解方法（名师方法，讲句子时照这个思路，但不要提方法出处）
核心：长难句 = 主干 + 修饰。按四步走：
1. 看标点做预判：句首短语/从句 + 单逗号，主干在逗号后；成对逗号或破折号中间是插入语、同位语，先跳过把主语和谓语连起来读；分号两边各是一句；冒号或句末破折号后面是解释。however / therefore 这类是副词，不能连接两个句子。
2. 数谓语、核连词：真谓语是带时态、被动（be done）或情态动词的动词；to do、doing、单独的 done 不算。只数连接句子的连词（连单词短语的 and 不算，后面跟非谓语的 while / when 不算）。连词数 = 谓语数 - 1；少了就找省略：作宾语的关系代词、宾语从句的 that、倒装省掉的 if。这一步自己心里数，用来找边界和省略，回答里不要列谓语、连词的个数；critics argue、I think 这类插入语自成一小句，单独说明，不算进公式。
3. 抓主干剥修饰：前面不带从属连词的那套主谓就是主干。从句按位置判断：在主语、宾语、表语位置或抽象名词后解释内容的是名词性从句；紧跟名词、关系词在从句里作成分的是定语从句；修饰动词或整句的是状语从句。that 在从句里作成分是定语从句，不作成分是同位语从句。规则动词过去式和过去分词同形，后面没宾语又没 be / have 的多半是过去分词作修饰，不是谓语。
4. 还原简化：遇到后置的 doing / done / 形容词短语、名词 + doing、复杂比较（more A than B、only as good as），不要只扔术语，直接把被省掉的部分用 [方括号] 补回去，让学习者看到它原来是哪个简单句。比如 When viewed against… ← When [today's indices are] viewed against…。
译文先保证结构对，再调成通顺中文：句首状语留在句首，长定语拆成短句，被动句不硬套"被"，补上"尽管……却……"这类逻辑词。

## 输出
- 默认（问"这句什么意思""看不懂"）：第一行给通顺译文；下一行用 [方括号] 括掉修饰、**加粗** 主干，例如 [Of all the changes…], **the most far-reaching has been the decline** [in…]；再一句点出最关键的难点（省略、还原或易错的谓语）。真长难句同时用 show_sentence_map 画图。全文 150 字以内；画完图不要再补考点或做题建议，除非学习者问。
- 学习者要"拆解 / 详细 / 精讲"（或点的是"长难句解析"）时，用 show_sentence_map 画图，正文按这几条写，每条一两句：主干（标明句型）；从句和插入语各修饰谁；省略或简化的地方用 [方括号] 补回原样；地道译文；四六级阅读里这句的考点（转折、结论、同义替换），卷子是四六级就别提考研。
"""


# 四六级各题型的讲题方法（名师方法提炼）：问到哪类题只加那一类
CET_GUIDES = {
    "careful": """仔细阅读（Section C）讲题：先讲题干在问什么、是哪类题，再定位（题干关键词 → 原文定位句，必要时看上下句），再拿定位句和选项做同义替换比对；不见根据不选。按题型套路：细节题看定位句主干；主旨题看首段转折后、各段首句和尾段结论；推理题也只是原文的同义改写，不往外多推一步；态度题先分清问作者还是某群体；词义题熟词的字面常义多半是错的，从上下文的同位语、or / but 推；例证题例子本身不是答案，答案是紧挨着的论点句。正确项特征：同义改写、概括、语气委婉。错项常见陷阱：偷换对象或程度（decline 变 disappear）、常识正确但原文没说、因果颠倒、范围扩大（some 变 all）、原词照搬但意思变了、张冠李戴到别的段或别的人。讲错项时点名是哪种陷阱。""",
    "matching": """长篇阅读段落匹配（Section B）讲题：每个题干先圈两个关键词（一个专有名词/数字/大写词这类好找的，加一个核心意思词），全文反复出现的主题词不能当定位词。原文按段落顺序往下读，一段一段对题，配上就划掉。正确段落几乎都是同义转述，题干和某段原词重合很多的，要警惕是原词复现的陷阱。一段可能对应两道题。讲题时写出：题干在说什么 → 定位词 → 原文哪段哪句（给出原句和中文意思） → 同义转述对照（题干的说法 = 原文的说法）。""",
    "banked": """选词填空（Section A，15 选 10）讲题：先看首句定文章基调，给 15 个备选词标词性（名、动、形、副，动词再分原形、三单、过去式/分词、ing；名词分单复数）。每个空先按语法定词性：冠词/形容词后填名词，副词后、be 后看语义填形容词或分词，主语后缺谓语填动词并看时态和单复数。再在同词性的候选里按语义和上下文复现、搭配挑；拿不准的先挂起，排除其他空后再回来。讲题时一句说语法槽位要什么词性和形式，一句说语义为什么是这个词。""",
    "listening": """听力讲题：讲清出题位在哪：新闻看开头一两句（主旨）和细节；长对话和篇章看转折（but / however / actually）、因果、强调、最高级、建议（should / had better）、列举后面的内容。四级多是听到原词就选，六级更多是同义替换。常见干扰项：只听到原词但意思不对、选项内容对但不是问的那个人或那个时间、常识正确但原文没说。复盘时指出他错在哪一类：没听出关键词、没反应过来同义替换、被干扰项骗了，还是没跟上语速；建议对着原文精听那一句。""",
    "writing": """写作讲题和批改：先说审题，题目是哪一类（观点论述、现象分析、书信/应用文、图表），对应开头段、主体段、结尾段各写什么。主体段用“观点句 + 理由/解释 + 例子”扩展，别堆模板句。批改按四六级 15 分制的档次给分数区间，最多指出 3 处最影响分数的问题（跑题、语法错、句式单一、衔接生硬），每处给一句改法。可以给一两个升级句式，但要贴合这篇的内容。""",
    "translation": """翻译讲题和批改：中文流水句先拆开，找出真正的主语和主谓，其他部分处理成从句、非谓语或介词短语；注意中英差异：中文无主句英文要补主语或用被动，中文多动词英文只留一个谓语，中文定语前置英文常后置。不会的词降级处理，用更简单的词或解释性说法，别空着。批改按 15 分制给分数区间，最多指出 3 处最扣分的问题（主谓不对、时态、漏译、中式英语），每处给改法，最后给一版参考译文。""",
}
_CET_WORDS = [("listening", r"听力"), ("banked", r"选词填空|15选10|十五选十"), ("matching", r"长篇阅读|段落匹配|信息匹配"), ("careful", r"仔细阅读|阅读理解"), ("writing", r"作文|写作"), ("translation", r"翻译(题|部分)|汉译英|段落翻译")]


def cet_kind(last: str, ctx: dict) -> str | None:
    """四六级卷子：按提问里的题型词、题号或卷面当前部分判断是哪一类题"""
    if not isinstance(ctx, dict) or ctx.get("article") or not re.search(r"四级|六级", str(ctx.get("paper", ""))):
        return None
    view = str(ctx.get("view") or "")
    sec = re.search(r"（(听力|选词填空|长篇阅读|仔细阅读|阅读理解|写作|翻译)）", view)
    if not re.search(r"第\s*\d{1,2}\s*题", last) and not any(re.search(p, last) for _, p in _CET_WORDS) and sec:
        return {"听力": "listening", "选词填空": "banked", "长篇阅读": "matching", "仔细阅读": "careful", "阅读理解": "careful", "写作": "writing", "翻译": "translation"}[sec.group(1)]
    for src in (last, view):
        m = re.search(r"第\s*(\d{1,2})\s*题", src)
        if not m:
            for k, pat in _CET_WORDS:
                if re.search(pat, src):
                    return k
        if m:
            n = int(m.group(1))
            return "listening" if n <= 25 else "banked" if n <= 35 else "matching" if n <= 45 else "careful" if n <= 55 else None
    return None


def translate_paras(cfg: dict, paras: list[str], p: str):
    """逐句翻一篇外刊并存进缓存 p；格式不对返回 None"""
    prompt = (
        "把下面每段英文按句子切开，逐句翻成自然、准确的简体中文（给四六级考生看）。"
        "只输出 JSON：一个数组，每段一个元素，元素是 [[英文原句, 中文], ...]；英文原句照抄、不改一个字。"
        f"一共 {len(paras)} 段，数组长度必须是 {len(paras)}。\n\n"
        + "\n\n".join(f"[{i + 1}] {t}" for i, t in enumerate(paras))
    )
    with upstream(cfg, [{"role": "user", "content": prompt}], False, 16000, 0.2, kind="trans") as r:
        out = (json.load(r)["choices"][0]["message"]["content"] or "").strip()
    out = re.sub(r"^```(?:json)?\s*|\s*```$", "", out)
    res = json.loads(out)
    if not isinstance(res, list) or len(res) != len(paras):
        return None
    res = [[[str(x[0]), str(x[1])] for x in para if isinstance(x, list) and len(x) >= 2] if isinstance(para, list) else [] for para in res]
    if any(t.strip() and not r for t, r in zip(paras, res)):
        return None
    os.makedirs(TRANS_DIR, exist_ok=True)
    tmp = f"{p}.{os.getpid()}.{threading.get_ident()}.tmp"  # 定时预翻和网页请求可能同时翻同一篇，各写各的临时文件
    with open(tmp, "w") as f:
        json.dump(res, f, ensure_ascii=False)
    os.replace(tmp, p)
    return res


def pretranslate():
    """服务器定时跑：外刊列表里还没有译文的文章提前翻好，读者打开就直接有"""
    cfg = load()
    for a in json.load(open(os.path.join(ARTICLES_DIR, "index.json"))):
        aid = str(a.get("id", ""))
        p = os.path.join(TRANS_DIR, aid + ".json")
        if not re.fullmatch(r"(voa|wiki)-\d+", aid) or os.path.exists(p):
            continue
        try:
            paras = [str(x["t"])[:4000] for x in json.load(open(os.path.join(ARTICLES_DIR, aid + ".json")))["paras"]]
            if not paras or len(paras) > 200 or sum(map(len, paras)) > 40000:
                continue
            print(aid, "ok" if translate_paras(cfg, paras, p) is not None else "格式不对", flush=True)
        except Exception as e:  # noqa: BLE001
            print(aid, "失败", e, flush=True)

def context_block(ctx: dict) -> str:
    parts = []
    if ctx.get("article"):
        parts.append(
            f"学习者在读一篇外刊：{str(ctx.get('paper', ''))[:200]}（{str(ctx['article'])[:300]}）。"
            "这不是考试卷，没有作答记录，别提复盘和错题。按四六级阅读的角度讲：长难句、同义替换、话题词汇；"
            "让出题就按四六级阅读题型（仔细阅读单选、段落匹配、选词填空）用 show_quiz 出。"
        )
        if ctx.get("paperText"):
            parts.append("文章原文（标题在第一行）：\n" + str(ctx["paperText"])[:30000])
        if ctx.get("sentence"):
            parts.append(f"正在看的句子：{str(ctx['sentence'])[:1200]}")
        if ctx.get("word"):
            parts.append(f"他点的词：{str(ctx['word'])[:60]}")
        return "\n".join(parts)
    if ctx.get("paper"):
        title = str(ctx["paper"])[:80]
        parts.append(f"试卷：{title}")
        if "四级" in title or "六级" in title:
            parts.append("这是大学英语四六级（CET）的卷子：只从四六级的角度讲，不要提考研。")
        elif "考研" in title:
            parts.append("这是考研英语的卷子：从考研的角度讲。")
    if ctx.get("sentence"):
        parts.append(f"正在看的句子：{str(ctx['sentence'])[:1200]}")
    if ctx.get("question") and not ctx.get("sentence"):
        parts.append("这次不是针对某个句子，是一般的备考问题。")
    if ctx.get("review") and ctx.get("reviewReady") is False:
        parts.append("学习者正在做这套卷，还没交卷。下面是作答进度；他问到具体题目时照常直接解答：\n" + str(ctx["review"])[:2000])
    elif ctx.get("review"):
        parts.append("这次是做完一套题后的复盘。作答数据（错题、没答和超时的题逐条列出）：\n" + str(ctx["review"])[:9000])
    if ctx.get("view"):
        parts.append("学习者此刻在卷面上的位置：" + str(ctx["view"])[:300])
    if ctx.get("marks"):
        parts.append("学习者在卷面上的标注（高亮、划线、便签）：\n" + str(ctx["marks"])[:3000])
    if ctx.get("ink"):
        parts.append(
            "学习者的手写笔记（已从笔迹识别成文字，可能有个别字认错）。先读懂它们：他圈了哪些词、写了什么释义、可能卡在哪；"
            "被问到笔记时归纳成几条要点，别逐条照念：\n" + str(ctx["ink"])[:3000]
        )
    if ctx.get("paperText"):
        parts.append("这套卷的原文（按页，从卷面文字层取；扫描卷可能有个别识别错字，按上下文理解）。问到某题时直接从这里找题目、选项和文章。每句一行，文章正文按卷面分好了段，标着〔第 N 段〕（每篇从 1 数，跨页接着数）；说“第几段”“第几句”、引用原文时都按这里的分段和分句来，别自己重新数：\n" + str(ctx["paperText"])[:40000])
    if ctx.get("word"):
        parts.append(f"他点的词：{str(ctx['word'])[:60]}")
    if ctx.get("syntax"):
        parts.append(f"这句已有的结构解析（可参考，有错可以纠正）：{json.dumps(ctx['syntax'], ensure_ascii=False)[:2000]}")
    return "\n".join(parts)


def clean_turns(msgs) -> list[dict]:
    """用户、助手（可带工具调用）、工具结果三种；开头不是用户的截掉，免得工具结果没有对应的调用"""
    out = []
    msgs = msgs if isinstance(msgs, list) else []
    users = [i for i, m in enumerate(msgs) if isinstance(m, dict) and m.get("role") == "user"]
    start = max(0, min(len(msgs) - MAX_TURNS, users[-1] if users else 0))  # 至少从最后一个提问开始
    for m in msgs[start:]:
        if not isinstance(m, dict) or not isinstance(m.get("content"), str):
            continue
        role = m.get("role")
        if role == "user":
            out.append({"role": "user", "content": m["content"][:4000]})
        elif role == "assistant":
            item = {"role": "assistant", "content": m["content"][:4000]}
            calls = [c for c in m.get("tool_calls") or [] if isinstance(c, dict) and isinstance(c.get("id"), str) and isinstance(c.get("name"), str)]
            if calls:
                item["tool_calls"] = [{"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": str(c.get("args") or "{}")[:6000]}} for c in calls]
            out.append(item)
        elif role == "tool" and isinstance(m.get("tool_call_id"), str):
            out.append({"role": "tool", "tool_call_id": m["tool_call_id"], "content": m["content"][:4000]})
    while out and out[0]["role"] != "user":
        out.pop(0)
    return out


# Agent 能调用的应用功能：模型只发起调用，真正执行在浏览器里（词典、生词本、错题本都存在学习者本机）
def _fn(name: str, desc: str, props: dict, required: list[str]) -> dict:
    return {"type": "function", "function": {"name": name, "description": desc, "parameters": {"type": "object", "properties": props, "required": required}}}


TOOLS = [
    _fn("lookup_word", "查学习者本机词典里一个英文单词的音标和中文释义。需要准确词义、熟词僻义时用。", {"word": {"type": "string", "description": "英文单词"}}, ["word"]),
    _fn("add_to_vocab", "把单词或短语加进学习者的生词本（同时进入背词卡片）。学习者说要记、要收藏某个词或短语时用。", {"word": {"type": "string", "description": "单词或短语"}, "meaning": {"type": "string", "description": "简短中文释义；词典里没有的词和短语靠它存进生词本，建议总是给"}, "sentence": {"type": "string", "description": "这个词出现的原句，可选"}}, ["word"]),
    _fn(
        "set_vocab_meaning",
        "改生词本里一个词或短语的常用释义：会显示在词典释义最前面，背词卡片也先背它。词典释义不是高频义、学习者说释义不对时用。",
        {"word": {"type": "string", "description": "单词（给原形）或短语"}, "meaning": {"type": "string", "description": "词性 + 中文，最常考的放前面，多个词性分行，如“v. 订购；定制\nn. 秩序”"}},
        ["word", "meaning"],
    ),
    _fn("add_to_mistakes", "把当前这套卷的某道选择题加进错题本，可附一句错因笔记。只在做题页（有试卷）时可用。", {"number": {"type": "integer", "description": "题号"}, "note": {"type": "string", "description": "错因或要点，可选"}}, ["number"]),
    _fn(
        "update_profile",
        "改写学习者档案（长期记忆）。学习者让你“记住”什么、或说出考试目标/日期/偏好时用。传入改写后的完整档案，栏目同系统提示里的档案。",
        {"profile": {"type": "string", "description": "完整的新档案（Markdown，栏目：考试目标、语法弱项、词汇弱项、题型表现、讲解偏好、最近在练）"}},
        ["profile"],
    ),
    _fn(
        "annotate_paper",
        "在学习者的卷面上高亮或划线（会显示 AI 角标），可以附一句释义（收在一个小便签图标里）。长难句不用它，用 mark_long_sentence。",
        {
            "text": {"type": "string", "description": "要标的原文，一字不差照抄卷面，只给要标的那几个词"},
            "style": {"type": "string", "enum": ["highlight", "underline"], "description": "highlight 高亮重点词句；underline 划线"},
            "note": {"type": "string", "description": "释义或要点，简短，可选"},
            "page": {"type": "integer", "description": "第几页，可选"},
        },
        ["text", "style"],
    ),
    _fn(
        "mark_long_sentence",
        "把一句长难句的结构标在卷面上：卷面上这句划蓝虚线，学习者点一下在底部看主干（按成分上色）、修饰成分、难点和译文，平时不占地方。学习者让你“标长难句 / 把这句标上 / 分析一下标到卷子上”时用，一句调用一次。",
        {
            "sentence": {"type": "string", "description": "卷面上的整句原文，一字不差照抄"},
            "main": {"type": "array", "description": "主干，按句中先后", "items": {"type": "object", "properties": {"text": {"type": "string", "description": "原句里的原词，照抄"}, "role": {"type": "string", "description": "主语、谓语、宾语、表语、宾语补足语、形式主语、真正主语"}}, "required": ["text", "role"]}},
            "parts": {"type": "array", "description": "从句、插入语、非谓语等修饰成分", "items": {"type": "object", "properties": {"text": {"type": "string", "description": "原句里的原文片段，照抄"}, "role": {"type": "string", "description": "如 定语从句、宾语从句、状语从句、插入语、非谓语作定语"}, "of": {"type": "string", "description": "修饰原句里的哪个词"}, "note": {"type": "string", "description": "一句中文要点，可选"}}, "required": ["text", "role"]}},
            "points": {"type": "array", "items": {"type": "string"}, "description": "难点，1–3 条，每条一句"},
            "translation": {"type": "string", "description": "按结构拆开的地道译文"},
            "page": {"type": "integer", "description": "第几页，可选"},
        },
        ["sentence", "main", "translation"],
    ),
    _fn(
        "list_vocab",
        "查看学习者的生词本：给 word 就查这个词在不在、背到哪了；否则按 filter 列出 recent（最近加的）或 due（今天该复习的）。",
        {"word": {"type": "string"}, "filter": {"type": "string", "enum": ["recent", "due"]}, "limit": {"type": "integer", "description": "最多列几个，默认 20"}},
        [],
    ),
    _fn("remove_from_vocab", "把一个词从学习者的生词本删掉。学习者说不要这个词了时用。", {"word": {"type": "string"}}, ["word"]),
    _fn("add_method", "把一条做题方法（比如定位句该往前看还是往后看、某类陷阱怎么识别）收进学习者的解题思路库。学习者说要记下这个方法/思路时用；写成能复用的一两句话，别写某题的答案。", {"text": {"type": "string", "description": "方法本身，一两句话"}, "kind": {"type": "string", "description": "适用题型，如 细节、推理、主旨、态度、听力、选词填空、段落匹配、翻译、写作；通用的不填"}}, ["text"]),
    _fn("mark_known", "把生词本里的一个词标成已掌握（两个月后再复习）。学习者说这个词会了时用。", {"word": {"type": "string"}}, ["word"]),
    _fn(
        "show_sentence_map",
        "在对话里画一张可点的长难句结构图：把句子按成分切成连续的块，主干、从句、修饰用不同颜色，点一块看作用。解析长难句时优先用它。",
        {
            "sentence": {"type": "string"},
            "translation": {"type": "string", "description": "整句译文"},
            "parts": {
                "type": "array",
                "description": "按原句顺序切块，拼起来就是原句",
                "items": {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string"},
                        "role": {"type": "string", "enum": ["subject", "predicate", "object", "clause", "modifier", "other"]},
                        "level": {"type": "integer", "description": "嵌套层级：主干 0，从句/修饰 1，从句里的从句 2"},
                        "label": {"type": "string", "description": "这一块是什么，如“定语从句，修饰 study”"},
                        "note": {"type": "string", "description": "这一块的中文意思或要点"},
                    },
                    "required": ["text", "role"],
                },
            },
        },
        ["parts"],
    ),
    _fn(
        "show_steps",
        "在对话里列一个能一步步展开的解题步骤。讲某道题怎么做时用，按顺序四步：读题（题目问什么、哪类题、定位词）→ 定位（拿哪个词回第几段，quote 放定位句，detail 说这句的中文意思）→ 解题（定位句和正确选项怎么同义替换）→ 排除（其他选项错在哪）。",
        {
            "question": {"type": "string", "description": "题号或题干简述"},
            "steps": {"type": "array", "items": {"type": "object", "properties": {"title": {"type": "string"}, "detail": {"type": "string"}, "quote": {"type": "string", "description": "这一步引用的原文，可选"}}, "required": ["title"]}},
            "answer": {"type": "string", "description": "最后的答案，如“选 B”"},
        },
        ["steps"],
    ),
    _fn(
        "show_cards",
        "在对话里放一组可翻面的词汇卡（正面词/短语和音标，背面释义和卷面原句）。讲到几个要记的词或短语时用。",
        {
            "cards": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "front": {"type": "string"},
                        "phonetic": {"type": "string"},
                        "pos": {"type": "string", "description": "词性，如 v. / n. / phr."},
                        "back": {"type": "string", "description": "常考释义"},
                        "here": {"type": "string", "description": "在这套卷原句里的意思"},
                        "collocations": {"type": "array", "items": {"type": "string"}, "description": "常见搭配 2-3 个"},
                        "synonyms": {"type": "array", "items": {"type": "string"}, "description": "四六级常见同义替换 2-3 个"},
                        "example": {"type": "string", "description": "卷面原句"},
                    },
                    "required": ["front", "back"],
                },
            }
        },
        ["cards"],
    ),
    _fn(
        "show_answer_map",
        "在对话里画一张答案解析图，按读题 → 定位 → 解题 → 排除排好：题目在问什么、怎么定位和定位句、原文和正确选项的同义替换对照、每个选项对错和理由。学习者看不懂某题答案时用。",
        {
            "question": {"type": "string", "description": "题号和题干简述"},
            "answer": {"type": "string", "description": "如“选 B”"},
            "ask": {"type": "string", "description": "题目在问什么：题干的中文意思 + 题型，点出定位词"},
            "locate": {"type": "string", "description": "怎么定位：拿哪个词回原文，在第几段找到"},
            "quote": {"type": "string", "description": "原文定位句，照抄"},
            "quoteZh": {"type": "string", "description": "定位句的中文意思，一句"},
            "pairs": {"type": "array", "items": {"type": "object", "properties": {"source": {"type": "string", "description": "原文里的说法"}, "option": {"type": "string", "description": "选项里的说法"}}}},
            "options": {"type": "array", "items": {"type": "object", "properties": {"letter": {"type": "string"}, "text": {"type": "string"}, "right": {"type": "boolean"}, "why": {"type": "string", "description": "对在哪或错在哪，一句话"}}}},
        },
        ["ask", "quote", "options"],
    ),
    _fn("get_weak_points", "读取学习者的薄弱点：长期记忆里的弱项，以及错题本里各题型还没掌握的题数。出练习、定计划前先调用。", {}, []),
    _fn(
        "show_quiz",
        "给学习者出一组能直接点选作答的单选练习题，界面上显示成题卡，他点了立即判对错、看解析。针对弱项出同类题时用。",
        {
            "title": {"type": "string", "description": "这组题练什么，如“细节题·同义替换”"},
            "questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "stem": {"type": "string", "description": "题干，英文；需要短文时把短文写在题干前面"},
                        "options": {"type": "array", "items": {"type": "string"}, "description": "四个选项，不带 A) 前缀"},
                        "answer": {"type": "string", "enum": ["A", "B", "C", "D"]},
                        "explain": {"type": "string", "description": "中文解析：为什么对、其他错在哪"},
                    },
                    "required": ["stem", "options", "answer", "explain"],
                },
            },
        },
        ["questions"],
    ),
]


# ---------- 上游 ----------
def record_usage(kind: str, model: str, u: dict):
    try:
        with sdb() as c:
            c.execute("INSERT INTO usage VALUES (?,?,?,?,?)", (time.time(), kind, model, int(u.get("prompt_tokens") or 0), int(u.get("completion_tokens") or 0)))
    except (sqlite3.Error, TypeError, ValueError, AttributeError):
        pass


class Metered:
    """包住上游响应：读完或流到最后一块时，把接口返回的 usage 记进 usage 表"""

    def __init__(self, r, kind: str, model: str):
        self.r, self.kind, self.model, self.done = r, kind, model, False

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.r.close()

    def close(self):
        self.r.close()

    def grab(self, raw: bytes):
        if self.done or b'"usage"' not in raw:
            return
        try:
            u = json.loads(raw).get("usage")
        except (json.JSONDecodeError, AttributeError):
            return
        if isinstance(u, dict) and u.get("prompt_tokens") is not None:
            self.done = True
            record_usage(self.kind, self.model, u)

    def read(self, *a):
        b = self.r.read(*a)
        self.grab(b)
        return b

    def __iter__(self):
        for line in self.r:
            if line.startswith(b"data:"):
                self.grab(line[5:].strip())
            yield line


def usage_summary() -> dict:
    now = time.time()
    day0 = time.mktime(time.localtime(now)[:3] + (0, 0, 0, 0, 0, -1))
    with sdb() as c:
        def tot(since: float):
            n, a, b = c.execute("SELECT COUNT(*), COALESCE(SUM(pin),0), COALESCE(SUM(pout),0) FROM usage WHERE t>=?", (since,)).fetchone()
            return {"calls": n, "in": a, "out": b}
        by = [{"kind": k, "model": m, "calls": n, "in": a, "out": b} for k, m, n, a, b in c.execute("SELECT kind, model, COUNT(*), SUM(pin), SUM(pout) FROM usage GROUP BY kind, model ORDER BY SUM(pin)+SUM(pout) DESC")]
        first = c.execute("SELECT MIN(t) FROM usage").fetchone()[0]
    return {"today": tot(day0), "week": tot(now - 7 * 86400), "all": tot(0), "by": by, "since": first}


def upstream(cfg: dict, messages: list[dict], stream: bool, max_tokens: int = 1800, temperature: float | None = None, model: str | None = None, tools: list | None = None, kind: str = "chat"):
    url = cfg["base_url"].rstrip("/") + "/chat/completions"
    body = {"model": model or cfg["model"], "messages": messages, "stream": stream, "max_tokens": max_tokens}
    if stream:
        body["stream_options"] = {"include_usage": True}
    if tools:
        body["tools"] = tools
    if cfg.get("thinking") is False and "deepseek" in body["model"].lower():
        body["thinking"] = {"type": "disabled"}  # 后台关了思考才关：开着要先想 7–15 秒才出字（思考过程会实时显示）
    t = cfg.get("temperature") if temperature is None else temperature
    if t is not None:
        body["temperature"] = t
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {cfg.get('api_key', '')}")
    req.add_header("User-Agent", "yingyu-agent/1.0")  # 不少接口在 Cloudflare 后面，默认的 Python-urllib 会被拦（1010）
    return Metered(urllib.request.urlopen(req, timeout=90), kind, body["model"])


def models(cfg: dict) -> list[str]:
    """Agent 头上能切的模型：默认模型在第一个，后面是后台填的其他可选模型"""
    extra = [m for m in cfg.get("models") or [] if isinstance(m, str) and m.strip()]
    d = cfg.get("model")
    return ([d] if d else []) + [m for m in extra if m != d]


def ready(cfg: dict) -> bool:
    return bool(cfg.get("base_url") and cfg.get("model") and cfg.get("api_key"))


def parse_ops(text: str) -> dict:
    a, b = text.find("{"), text.rfind("}")
    try:
        d = json.loads(text[a : b + 1]) if a >= 0 < b else {}
    except json.JSONDecodeError:
        d = {}
    ops = {"add": [], "update": [], "remove": []}
    for x in d.get("add", []) if isinstance(d.get("add"), list) else []:
        if isinstance(x, dict) and isinstance(x.get("text"), str) and x["text"].strip():
            ops["add"].append({"kind": x.get("kind") if x.get("kind") in ("weak", "pref", "fact") else "weak", "text": x["text"].strip()[:200]})
    for x in d.get("update", []) if isinstance(d.get("update"), list) else []:
        if isinstance(x, dict) and isinstance(x.get("id"), int) and isinstance(x.get("text"), str):
            ops["update"].append({"id": x["id"], "text": x["text"].strip()[:200]})
    ops["remove"] = [x for x in d.get("remove", []) if isinstance(x, int)] if isinstance(d.get("remove"), list) else []
    return ops


# ---------- HTTP ----------
class Handler(BaseHTTPRequestHandler):
    server_version = "yz-agent"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # 不记录请求内容
        sys.stderr.write(f"{self.address_string()} {self.command} {self.path.split('?')[0]} {args[1] if len(args) > 1 else ''}\n")

    def ip(self) -> str:
        return self.headers.get("X-Real-IP") or self.client_address[0]

    def send_json(self, code: int, data, headers: dict | None = None):
        raw = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            return None
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            return None

    def cookie(self, name: str) -> str | None:
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == name:
                return v
        return None

    def admin(self, cfg: dict) -> bool:
        return valid_session(cfg, self.cookie("yz_admin"))

    # ---- GET ----
    def do_GET(self):
        path = self.path.split("?")[0]
        cfg = load()
        if path.startswith("/api/handoff/"):
            tok, nonce = path.rsplit("/", 1)[1], self.cookie("yz_ho") or ""
            with _handoff_lock:
                e = _handoffs.get(tok)
                ok = bool(e and e[0] >= time.time() and nonce and hmac.compare_digest(e[1], nonce))
                if ok:
                    del _handoffs[tok]
            if not ok:
                return self.send_json(404, {"error": "没有这份数据"})
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(e[2])))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Set-Cookie", "yz_ho=; Path=/api/handoff; Max-Age=0")
            self.end_headers()
            return self.wfile.write(e[2])
        if path == "/api/auth/me":
            u = self.user()
            return self.send_json(200, {"name": u[1]}) if u else self.send_json(401, {"error": "没登录"})
        if path == "/api/agent/trans":
            aid = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("id", [""])[0]
            p = os.path.join(TRANS_DIR, aid + ".json")
            if re.fullmatch(r"(voa|wiki)-\d+", aid) and os.path.exists(p):
                return self.send_json(200, json.load(open(p)))
            return self.send_json(404, {"error": "还没有译文"})
        if path in ("/admin", "/admin/"):
            raw = ADMIN_HTML.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(raw)
        elif path == "/api/agent/status":
            self.send_json(200, {"enabled": ready(cfg), "locked": bool(cfg.get("access_code")), "activated": self.activated(cfg)})
        elif path == "/api/agent/models" and not self.activated(cfg):
            self.send_json(403, {"error": "这台设备还没激活 Agent"})
        elif path == "/api/agent/models":
            self.send_json(200, {"models": models(cfg) if ready(cfg) else [], "default": cfg.get("model", "") if ready(cfg) else ""})
        elif path == "/api/admin/config":
            if not self.admin(cfg):
                return self.send_json(401, {"error": "请先登录"})
            key = cfg.get("api_key", "")
            self.send_json(200, {"models": cfg.get("models") or [], "base_url": cfg.get("base_url", ""), "model": cfg.get("model", ""), "temperature": cfg.get("temperature"), "access_code": cfg.get("access_code", ""), "api_key_set": bool(key), "api_key_tail": key[-4:] if key else ""})
        elif path == "/api/admin/usage":
            if not self.admin(cfg):
                return self.send_json(401, {"error": "请先登录"})
            self.send_json(200, usage_summary())
        else:
            self.send_json(404, {"error": "not found"})

    # ---- POST / PUT ----
    def do_PUT(self):
        self.do_POST()

    def do_POST(self):
        path = self.path.split("?")[0]
        cfg = load()
        data = self.body()
        if data is None or not isinstance(data, dict):
            return self.send_json(400, {"error": "请求格式不对"})
        if path == "/api/admin/login":
            if limited(_fails, self.ip(), 10, 900):
                return self.send_json(429, {"error": "试错太多次，15 分钟后再来"})
            if not cfg.get("admin_hash") or not check_pw(str(data.get("password", "")), cfg["admin_hash"]):
                return self.send_json(401, {"error": "密码不对" if cfg.get("admin_hash") else "还没设密码：在服务器上运行 set-password"})
            exp = int(time.time()) + SESSION_SEC
            secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
            return self.send_json(200, {"ok": True}, {"Set-Cookie": f"yz_admin={sign(cfg, exp)}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_SEC}{secure}"})
        if path == "/api/handoff":
            if limited(_handoff_hits, self.ip(), 20, 3600):
                return self.send_json(429, {"error": "太频繁"})
            tok, nonce, now = secrets.token_urlsafe(24), secrets.token_urlsafe(24), time.time()
            with _handoff_lock:
                for k in [k for k, v in _handoffs.items() if v[0] < now]:
                    del _handoffs[k]
                if len(_handoffs) >= 200:
                    return self.send_json(503, {"error": "太忙"})
                _handoffs[tok] = (now + 900, nonce, json.dumps(data, ensure_ascii=False).encode())
            return self.send_json(200, {"token": tok}, {"Set-Cookie": f"yz_ho={nonce}; Path=/api/handoff; Max-Age=900; HttpOnly; SameSite=Lax"})
        if path == "/api/admin/logout":
            return self.send_json(200, {"ok": True}, {"Set-Cookie": "yz_admin=; Path=/; Max-Age=0"})
        if path == "/api/admin/config":
            if not self.admin(cfg):
                return self.send_json(401, {"error": "请先登录"})
            for k in ("base_url", "model"):
                if isinstance(data.get(k), str):
                    cfg[k] = data[k].strip()
            if isinstance(data.get("access_code"), str):
                ac = data["access_code"].strip()
                # 激活码放在请求头里，浏览器只允许 ASCII
                if not re.fullmatch(r"[\x21-\x7e]{0,64}", ac):
                    return self.send_json(400, {"error": "激活码只能用英文字母、数字和符号，最多 64 位"})
                cfg["access_code"] = ac
            if isinstance(data.get("models"), list):
                cfg["models"] = [str(m).strip() for m in data["models"] if str(m).strip()][:20]
            if isinstance(data.get("api_key"), str) and data["api_key"].strip():
                cfg["api_key"] = data["api_key"].strip()
            t = data.get("temperature")
            cfg["temperature"] = float(t) if isinstance(t, (int, float)) else None
            save(cfg)
            return self.send_json(200, {"ok": True})
        if path == "/api/admin/test":
            if not self.admin(cfg):
                return self.send_json(401, {"error": "请先登录"})
            if not ready(cfg):
                return self.send_json(400, {"error": "地址、模型、密钥要先填全"})
            try:
                t0 = time.time()
                with upstream(cfg, [{"role": "user", "content": "用一句中文说：连接成功"}], False, 40, kind="test") as r:
                    reply = json.load(r)["choices"][0]["message"]["content"]
                return self.send_json(200, {"ok": True, "reply": reply, "ms": int((time.time() - t0) * 1000)})
            except Exception as e:  # noqa: BLE001
                return self.send_json(502, {"error": upstream_error(e)})
        if path in ("/api/auth/register", "/api/auth/login"):
            return self.auth(cfg, data, path.endswith("register"))
        if path == "/api/auth/logout":
            tok = self.cookie("yz_sess")
            if tok:
                with sdb() as c:
                    c.execute("DELETE FROM sessions WHERE token=?", (tok,))
            return self.send_json(200, {"ok": True}, {"Set-Cookie": "yz_sess=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"})
        if path == "/api/sync":
            return self.sync(data)
        if path == "/api/agent/activate":
            if limited(_bad_codes, self.ip(), 10, 900):
                return self.send_json(429, {"error": "输错太多次，15 分钟后再试"})
            code = cfg.get("access_code") or ""
            if not code or hmac.compare_digest(str(data.get("code") or "").strip().encode(), code.encode()):
                with _lock:
                    _bad_codes.pop(self.ip(), None)
                return self.send_json(200, {"ok": True})
            return self.send_json(403, {"error": "激活码不对"})
        if path.startswith("/api/agent/") and not self.activated(cfg):
            return self.send_json(403, {"error": "这台设备还没激活 Agent，请输入激活码"})
        if path == "/api/agent/chat":
            return self.chat(cfg, data)
        if path == "/api/agent/ink":
            return self.ink(cfg, data)
        if path == "/api/agent/sent":
            return self.sent(cfg, data)
        if path == "/api/agent/trans":
            return self.trans(cfg, data)
        if path == "/api/agent/remember":
            return self.remember(cfg, data)
        self.send_json(404, {"error": "not found"})

    def user(self):
        """当前登录的用户 (id, name)，没登录是 None"""
        tok = self.cookie("yz_sess")
        if not tok:
            return None
        with sdb() as c:
            return c.execute("SELECT users.id, users.name FROM sessions JOIN users ON users.id = sessions.uid WHERE token=? AND exp>?", (tok, time.time())).fetchone()

    def auth(self, cfg: dict, data: dict, register: bool):
        name = str(data.get("name", "")).strip()
        pw = str(data.get("password", ""))
        ip = self.ip()
        if limited(_auth_hits, ip, 20, 900):
            return self.send_json(429, {"error": "试得太频繁了，过 15 分钟再试"})
        if register:
            if cfg.get("allow_register") is False:
                return self.send_json(403, {"error": "暂不开放注册"})
            if not NAME_RE.fullmatch(name):
                return self.send_json(400, {"error": "用户名 2-20 个字，只能用中英文、数字和下划线"})
            if len(pw) < 6 or len(pw) > 128:
                return self.send_json(400, {"error": "密码至少 6 位"})
            if limited(_reg_hits, ip, 5, 3600):
                return self.send_json(429, {"error": "注册太频繁了，过一会儿再试"})
            try:
                with sdb() as c:
                    uid = c.execute("INSERT INTO users (name, pw, created) VALUES (?,?,?)", (name, hash_pw(pw), time.time())).lastrowid
            except sqlite3.IntegrityError:
                return self.send_json(409, {"error": "这个用户名已经有人用了"})
        else:
            with sdb() as c:
                row = c.execute("SELECT id, pw, name FROM users WHERE name=?", (name,)).fetchone()
            if not row or not check_pw(pw, row[1]):
                return self.send_json(403, {"error": "用户名或密码不对"})
            uid, name = row[0], row[2]
        tok = secrets.token_urlsafe(32)
        with sdb() as c:
            c.execute("DELETE FROM sessions WHERE exp<?", (time.time(),))
            c.execute("INSERT INTO sessions VALUES (?,?,?)", (tok, uid, time.time() + SESSION_DAYS * 86400))
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
        return self.send_json(200, {"name": name}, {"Set-Cookie": f"yz_sess={tok}; Path=/; Max-Age={SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax{secure}"})

    def sync(self, data: dict):
        """按条同步：push 是本机改过的行（row 为 null 表示删了），t 是改的时间，后改的为准；返回 since 之后别的设备改过的行"""
        u = self.user()
        if not u:
            return self.send_json(401, {"error": "没登录"})
        uid = u[0]
        push = data.get("push") or []
        since = int(data.get("since") or 0)
        if not isinstance(push, list) or len(push) > 2000:
            return self.send_json(400, {"error": "参数不对"})
        with sdb() as c:
            c.execute("BEGIN IMMEDIATE")  # 先拿写锁再读序号，两台设备同时同步也不会拿到同一个号
            seq = c.execute("SELECT seq FROM users WHERE id=?", (uid,)).fetchone()[0]
            mine = set()
            for it in push:
                tbl, k, t = str(it.get("tbl", "")), str(it.get("k", ""))[:500], float(it.get("t") or 0)
                if tbl not in SYNC_TABLES or not k:
                    continue
                old = c.execute("SELECT t FROM rows WHERE uid=? AND tbl=? AND k=?", (uid, tbl, k)).fetchone()
                if old and (old[0] > t or t <= 1):  # t<=1 是首次登录导入的本机旧数据，服务器上已有的不覆盖
                    continue
                seq += 1
                raw = json.dumps(it.get("row"), ensure_ascii=False)
                if len(raw) > 2_000_000:
                    continue
                c.execute("INSERT OR REPLACE INTO rows VALUES (?,?,?,?,?,?)", (uid, tbl, k, raw, t, seq))
                mine.add(seq)
            c.execute("UPDATE users SET seq=? WHERE id=?", (seq, uid))
            got = c.execute("SELECT tbl, k, data, t, seq FROM rows WHERE uid=? AND seq>? ORDER BY seq LIMIT 3000", (uid, since)).fetchall()
        pull = [{"tbl": r[0], "k": r[1], "row": json.loads(r[2]), "t": r[3]} for r in got if r[4] not in mine]
        last = got[-1][4] if got else since
        return self.send_json(200, {"pull": pull, "seq": max(last, since) if len(got) == 3000 else seq, "more": len(got) == 3000})

    def trans(self, cfg: dict, data: dict):
        """外刊逐句翻译：返回每段的 [[英文句, 中文], ...]，存起来下次直接给"""
        aid = str(data.get("id", ""))
        if not re.fullmatch(r"(voa|wiki)-\d+", aid):
            return self.send_json(400, {"error": "参数不对"})
        # 原文从服务器上的文章取，不用请求里带的：译文是大家共用的，不能让人塞别的内容进缓存
        try:
            paras = [str(p["t"])[:4000] for p in json.load(open(os.path.join(ARTICLES_DIR, aid + ".json")))["paras"]]
        except (OSError, ValueError, KeyError, TypeError):
            return self.send_json(404, {"error": "没有这篇文章"})
        if not paras or len(paras) > 200:
            return self.send_json(400, {"error": "文章太长"})
        if sum(map(len, paras)) > 40000:
            return self.send_json(400, {"error": "文章太长"})
        p = os.path.join(TRANS_DIR, aid + ".json")
        if os.path.exists(p):
            return self.send_json(200, json.load(open(p)))
        if limited(_trans_hits, self.ip(), 20, 3600):
            return self.send_json(429, {"error": "翻译太频繁，过一会儿再试"})
        with _lock:
            if aid in _trans_busy:
                return self.send_json(409, {"error": "正在翻译，稍等再试"})
            _trans_busy.add(aid)
        try:
            res = translate_paras(cfg, paras, p)
            if res is None:
                return self.send_json(502, {"error": "译文格式不对，再试一次"})
            return self.send_json(200, res)
        except Exception as e:  # noqa: BLE001
            return self.send_json(502, {"error": upstream_error(e) if isinstance(e, urllib.error.URLError) else "翻译失败，再试一次"})
        finally:
            with _lock:
                _trans_busy.discard(aid)

    def activated(self, cfg: dict) -> bool:
        """服务器没设激活码就都算激活；设了就要请求头里带对"""
        code = cfg.get("access_code") or ""
        if not code:
            return True
        got = (self.headers.get("X-Agent-Code") or "").strip()
        if not got:
            return False
        # 任何接口带错的激活码都算一次输错，和 /api/agent/activate 共用限流，免得拿 status 无限试
        now = time.time()
        with _lock:
            if len([t for t in _bad_codes.get(self.ip(), []) if now - t < 900]) >= 10:
                return False
        if hmac.compare_digest(got.encode(), code.encode()):
            return True
        limited(_bad_codes, self.ip(), 10, 900)
        return False

    def ink(self, cfg: dict, data: dict):
        """手写笔记截图 → 文字：用能看图的模型（可选模型里第一个 Gemini，没有就用默认模型）"""
        if not ready(cfg):
            return self.send_json(503, {"error": "AI 助教还没配置好"})
        if limited(_ink_hits, self.ip(), 200, 600):
            return self.send_json(429, {"error": "识别太频繁"})
        png = data.get("png")
        if not isinstance(png, str) or not png.startswith("data:image/png;base64,") or len(png) > 240_000:
            return self.send_json(400, {"error": "图片不对"})
        text = INK
        if isinstance(data.get("covered"), str) and data["covered"].strip():
            text += "\n被这块笔迹圈住或划到的印刷词（图里没有印刷字）：" + data["covered"][:200]
        if isinstance(data.get("near"), str) and data["near"].strip():
            text += "\n附近的印刷文字（只帮你认字，不要输出）：" + data["near"][:300]
        msgs = [{"role": "user", "content": [{"type": "text", "text": text}, {"type": "image_url", "image_url": {"url": png}}]}]
        vision = cfg.get("vision_model") or next((m for m in models(cfg) if "gemini" in m.lower()), None)
        try:
            with upstream(cfg, msgs, False, 3000, 0, model=vision, kind="ink") as r:
                out = (json.load(r)["choices"][0]["message"]["content"] or "").strip()
        except Exception as e:  # noqa: BLE001
            return self.send_json(502, {"error": upstream_error(e)})
        self.send_json(200, {"text": out[:300]})

    def chat(self, cfg: dict, data: dict):
        if not ready(cfg):
            return self.send_json(503, {"error": "AI 助教还没配置好"})
        if limited(_hits, self.ip(), *RATE):
            return self.send_json(429, {"error": "问得太快了，歇一会儿再问"})
        turns = clean_turns(data.get("messages"))
        if not turns or turns[-1]["role"] not in ("user", "tool"):
            return self.send_json(400, {"error": "没有问题"})
        sys_msg = SYSTEM + f"\n\n今天是 {today()}。" + "\n\n## 关于这位学习者\n" + profile_block(data)
        last = next((str(t.get("content") or "") for t in reversed(turns) if t.get("role") == "user"), "")
        c0 = data.get("context") or {}
        if (isinstance(c0, dict) and c0.get("sentence")) or re.search(r"长难句|句子|这句|主干|结构|拆解|从句", last):
            sys_msg += LONG_GUIDE
        kind = cet_kind(last, c0 if isinstance(c0, dict) else {})
        if kind:
            sys_msg += "\n\n## 这类题怎么讲（名师方法，照这个思路讲，但不要提出处；回答格式仍按上面的要求，简短）\n" + CET_GUIDES[kind]
        ctx = context_block(data.get("context") or {})
        if ctx:
            sys_msg += "\n\n" + ctx
        try:
            pick = data.get("model") if data.get("model") in models(cfg) else None
            r = upstream(cfg, [{"role": "system", "content": sys_msg}, *turns], True, 8000, model=pick, tools=TOOLS if data.get("tools") else None)
        except Exception as e:  # noqa: BLE001
            return self.send_json(502, {"error": upstream_error(e)})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        calls: dict[int, dict] = {}  # 流式的工具调用按 index 一段段拼起来
        try:
            with r:
                for line in r:
                    line = line.strip()
                    if not line.startswith(b"data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == b"[DONE]":
                        break
                    try:
                        d = json.loads(payload)["choices"][0].get("delta") or {}
                    except (json.JSONDecodeError, KeyError, IndexError, TypeError):
                        continue
                    delta = d.get("content")
                    if d.get("reasoning_content"):  # 会思考的模型先想再答：把想的过程也传过去，前端不至于干等
                        self.wfile.write(b"data: " + json.dumps({"think": d["reasoning_content"]}, ensure_ascii=False).encode() + b"\n\n")
                        self.wfile.flush()
                    for tc in d.get("tool_calls") or []:
                        c = calls.setdefault(tc.get("index", 0), {"id": "", "name": "", "args": ""})
                        f = tc.get("function") or {}
                        c["id"] = tc.get("id") or c["id"]
                        c["name"] = c["name"] or f.get("name") or ""
                        c["args"] += f.get("arguments") or ""
                    if delta:
                        self.wfile.write(b"data: " + json.dumps({"t": delta}, ensure_ascii=False).encode() + b"\n\n")
                        self.wfile.flush()
            if calls:
                out = [{"id": c["id"] or f"call_{k}", "name": c["name"], "args": c["args"] or "{}"} for k, c in sorted(calls.items()) if c["name"]]
                self.wfile.write(b"data: " + json.dumps({"calls": out}, ensure_ascii=False).encode() + b"\n\n")
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # noqa: BLE001
            try:
                self.wfile.write(b"data: " + json.dumps({"error": upstream_error(e)}, ensure_ascii=False).encode() + b"\n\n")
            except OSError:
                pass

    def sent(self, cfg: dict, data: dict):
        """生词本出处句 → 中文译文（卷子的译文层里没有这句时用）"""
        if not ready(cfg):
            return self.send_json(503, {"error": "AI 助教还没配置好"})
        s = str(data.get("sentence") or "").strip()
        if not s or len(s) > 800:
            return self.send_json(400, {"error": "句子不对"})
        if limited(_sent_hits, self.ip(), 200, 3600):
            return self.send_json(429, {"error": "翻译太频繁"})
        msgs = [{"role": "user", "content": "把下面这句英语考试原文翻成通顺的中文，只输出译文：\n" + s}]
        try:
            with upstream(cfg, msgs, False, 600, 0.2, kind="sent") as r:
                zh = (json.load(r)["choices"][0]["message"]["content"] or "").strip()
        except Exception as e:  # noqa: BLE001
            return self.send_json(502, {"error": upstream_error(e)})
        self.send_json(200, {"zh": zh[:600]})

    def remember(self, cfg: dict, data: dict):
        if not ready(cfg):
            return self.send_json(503, {"error": "AI 助教还没配置好"})
        if limited(_hits, self.ip(), *RATE):
            return self.send_json(429, {"error": "太频繁"})
        turns = clean_turns(data.get("messages"))
        if not turns:
            return self.send_json(200, {"profile": None})
        profile = str(data.get("profile") or "")[:3000]
        convo = "\n".join(f"{'学习者' if t['role'] == 'user' else '助教'}：{t['content'][:1500]}" for t in turns if t["role"] in ("user", "assistant") and t["content"])
        msgs = [{"role": "system", "content": REMEMBER + f"\n今天是 {today()}，写日期时用完整年份。"}, {"role": "user", "content": f"现在的档案：\n{profile or '（空的）'}\n\n对话：\n{convo}"}]
        try:
            with upstream(cfg, msgs, False, 1600, 0, kind="remember") as r:
                text = (json.load(r)["choices"][0]["message"]["content"] or "").strip()
        except Exception as e:  # noqa: BLE001
            return self.send_json(502, {"error": upstream_error(e)})
        text = re.sub(r"^```(?:markdown|md)?\s*|\s*```$", "", text).strip()
        self.send_json(200, {"profile": None if not text or text.upper().startswith("NOCHANGE") else text[:4000]})


def upstream_error(e: Exception) -> str:
    if isinstance(e, urllib.error.HTTPError):
        try:
            detail = json.loads(e.read() or b"{}").get("error", {})
            msg = detail.get("message") if isinstance(detail, dict) else str(detail)
        except Exception:  # noqa: BLE001
            msg = ""
        return f"模型接口返回 {e.code}{'：' + msg[:200] if msg else ''}"
    if isinstance(e, urllib.error.URLError):
        return f"连不上模型接口：{e.reason}"
    return f"模型接口出错：{type(e).__name__}"


ADMIN_HTML = """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>英语之道 · AI 助教后台</title>
<style>
*{box-sizing:border-box}body{margin:0;font:15px/1.6 system-ui,-apple-system,"PingFang SC","Noto Sans CJK SC",sans-serif;background:#f4f3ef;color:#1d1d1f}
main{max-width:520px;margin:48px auto;padding:0 20px}h1{font-size:22px;margin:0 0 4px}p.sub{color:#6b6b70;margin:0 0 24px}
.card{background:#fff;border-radius:14px;padding:22px;box-shadow:0 1px 2px rgba(0,0,0,.06),0 0 0 1px rgba(0,0,0,.05)}
label{display:block;font-size:13px;color:#6b6b70;margin:14px 0 6px}label:first-child{margin-top:0}
input{width:100%;height:40px;border:0;border-radius:9px;padding:0 12px;font:inherit;background:#f4f3ef;outline:none}input:focus{box-shadow:0 0 0 2px #2f6bff55}
.row{display:flex;gap:10px;margin-top:20px;align-items:center}button{height:40px;border:0;border-radius:999px;padding:0 18px;font:inherit;font-weight:600;cursor:pointer;background:#ecebe6;color:#1d1d1f}
button.primary{background:#2f6bff;color:#fff}button:disabled{opacity:.5}.hint{font-size:13px;color:#6b6b70;margin-top:6px}
#msg{margin-top:14px;font-size:14px;white-space:pre-wrap}.ok{color:#1a7f45}.err{color:#c62828}.out{margin-left:auto;background:none;color:#6b6b70;font-weight:500}
</style></head><body><main>
<h1>AI 助教后台</h1><p class="sub">填 OpenAI 兼容接口。密钥只存在服务器上，网页拿不到。</p>
<div class="card" id="login" hidden><label>管理密码</label><input id="pw" type="password" autocomplete="current-password">
<div class="row"><button class="primary" id="go">登录</button></div><div id="lmsg" class="err" style="margin-top:12px"></div></div>
<div class="card" id="form" hidden>
<label>接口地址（到 /v1 为止）</label><input id="base_url" placeholder="https://api.deepseek.com/v1">
<label>模型名</label><input id="model" placeholder="deepseek-chat">
<label>API Key</label><input id="api_key" type="password" autocomplete="off"><div class="hint" id="keyhint"></div>
<label>温度（可空，默认用接口的）</label><input id="temperature" inputmode="decimal" placeholder="0.3">
<div class="row"><button class="primary" id="save">保存</button><button id="test">测试连接</button><button class="out" id="logout">退出</button></div>
<div id="msg"></div></div>
<div class="card" id="usage" hidden style="margin-top:16px"><label>模型用量（token，接口自己报的数）</label><table id="ut" style="width:100%;font-size:14px;border-collapse:collapse"></table><div class="hint" id="uhint"></div></div>
</main><script>
const $=id=>document.getElementById(id);
async function api(p,o={}){const r=await fetch(p,{credentials:"same-origin",headers:{"Content-Type":"application/json"},...o});let d={};try{d=await r.json()}catch{}return[r.status,d]}
const KIND={chat:"提问",ink:"手写识别",trans:"外刊翻译",remember:"更新记忆",sent:"生词原句翻译",test:"测试连接"};const fmt=n=>Number(n||0).toLocaleString("zh-CN");
async function usage(){const[s,d]=await api("/api/admin/usage");if(s!==200)return;const r=(a,b,c,e)=>`<tr><td style="padding:4px 0">${a}</td><td align="right">${b}</td><td align="right">${c}</td><td align="right">${e}</td></tr>`;
$("ut").innerHTML=r("<b>范围</b>","<b>次数</b>","<b>输入</b>","<b>输出</b>")+[["今天",d.today],["近 7 天",d.week],["全部",d.all]].map(([n,x])=>r(n,fmt(x.calls),fmt(x.in),fmt(x.out))).join("")+d.by.map(x=>r((KIND[x.kind]||x.kind)+" · "+x.model,fmt(x.calls),fmt(x.in),fmt(x.out))).join("");
$("uhint").textContent=d.since?"从 "+new Date(d.since*1000).toLocaleString("zh-CN")+" 开始记录":"还没有调用记录";$("usage").hidden=false}
function say(t,ok){$("msg").textContent=t;$("msg").className=ok?"ok":"err"}
async function boot(){const[s,d]=await api("/api/admin/config");if(s===401){$("login").hidden=false;$("form").hidden=true;$("pw").focus();return}
$("login").hidden=true;$("form").hidden=false;usage();$("base_url").value=d.base_url||"";$("model").value=d.model||"";$("temperature").value=d.temperature??"";
$("api_key").value="";$("api_key").placeholder=d.api_key_set?"已保存（不改就留空）":"sk-...";$("keyhint").textContent=d.api_key_set?"已保存的密钥尾号 "+d.api_key_tail:"还没填"}
$("go").onclick=async()=>{const[s,d]=await api("/api/admin/login",{method:"POST",body:JSON.stringify({password:$("pw").value})});if(s===200){$("pw").value="";boot()}else $("lmsg").textContent=d.error||"登录失败"};
$("pw").onkeydown=e=>e.key==="Enter"&&$("go").click();
$("save").onclick=async()=>{const t=$("temperature").value.trim();const[s,d]=await api("/api/admin/config",{method:"PUT",body:JSON.stringify({base_url:$("base_url").value,model:$("model").value,api_key:$("api_key").value,temperature:t===""?null:Number(t)})});if(s===200){say("已保存",true);boot()}else say(d.error||"保存失败")};
$("test").onclick=async()=>{$("test").disabled=true;say("测试中…",true);const[s,d]=await api("/api/admin/test",{method:"POST",body:"{}"});$("test").disabled=false;s===200?say("连接成功（"+d.ms+" ms）："+d.reply,true):say(d.error||"失败")};
$("logout").onclick=async()=>{await api("/api/admin/logout",{method:"POST",body:"{}"});boot()};
boot();
</script></body></html>"""


def main():
    args = sys.argv[1:]
    cmd = args[0] if args else "serve"
    if cmd == "set-password":
        pw = os.environ.get("YZ_ADMIN_PASSWORD") or getpass.getpass("新的管理密码：")
        if len(pw) < 8:
            sys.exit("密码至少 8 位")
        cfg = load()
        cfg["admin_hash"] = hash_pw(pw)
        cfg["secret"] = secrets.token_hex(32)  # 换密码时旧的登录全部失效
        save(cfg)
        print("已设置，配置在", CONFIG)
        return
    if cmd == "serve":
        port = int(args[args.index("--port") + 1]) if "--port" in args else 8787
        host = os.environ.get("YZ_AGENT_HOST", "127.0.0.1")
        print(f"yz-agent on {host}:{port}, config {CONFIG}", flush=True)
        ThreadingHTTPServer((host, port), Handler).serve_forever()
        return
    sys.exit(__doc__)


if __name__ == "__main__":
    if sys.argv[1:] == ["pretranslate"]:
        pretranslate()
    else:
        main()
