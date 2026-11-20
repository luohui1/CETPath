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
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CONFIG = os.environ.get("YZ_AGENT_CONFIG", "/srv/yingyu/config/agent.json")
MAX_BODY = 256 * 1024
MAX_TURNS = 24
MAX_MEMORY = 60
SESSION_SEC = 7 * 86400
RATE = (40, 600)  # 每个 IP 每 10 分钟最多 40 次提问
_lock = threading.Lock()
_hits: dict[str, list[float]] = {}
_bad_codes: dict[str, list[float]] = {}
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
- 回答要短、说人话：先给结论，能用三五句或几条要点说清就别多写；少用术语，非用不可时顺手用大白话解释一下。
- 按这套卷属于的考试来讲：四六级的卷子只从四六级出发（题型、分值、常考点、四六级怎么出题），不要扯考研；考研的卷子同理。没有试卷时按学习者档案里的考试目标。
- 一切围绕考试：讲清这个点在四六级/考研里怎么考、怎么在阅读/翻译/写作里用、常见陷阱。
- 学习者问什么就直接答什么。问某道题怎么做、选什么，直接给出答案，再讲依据：原文定位句、同义替换、其他选项错在哪。不要只讲方法不给答案，也不要反问让他自己想。

## 解析一个句子
真正的长难句才用下面的完整结构（每部分用 ### 小标题，每部分一两句话）；简单的句子直接给译文和一两句要点：
### 一句话意思
自然通顺的中文译文。
### 主干
主语 + 谓语 + 宾语/表语，主干词用 **加粗**，例如 **The study** **suggests** **that…**。
### 修饰成分
用列表逐条说：从句、非谓语、介词短语、插入语分别修饰谁、起什么作用。英文片段用 `反引号` 括起来。
### 难点 / 考点
点出倒装、省略、分隔、特殊句式、熟词僻义、指代等易错处，说明在考试里常怎么出（如阅读同义替换、翻译拆句）。
### 记一下
一两条可以直接带走的结论或技巧；有必要时给一个简短仿写例句，用 > 引用。

## 解释一个词
给出在这句里的意思和词性、它在句中的作用、四六级/考研常考义和搭配、同义替换词；熟词僻义要特别提醒。

## 复盘一套卷子
给了作答数据时（学习者刚做完一套题）：
- 先一句话总评：得分、最弱的题型、最拖时间的部分。
### 错因分析
按题型归类错题，判断每类是词汇、长难句、定位、同义替换、推理过度还是干扰项的问题，写明题号。
### 时间分配
指出超出建议用时的题型和题号，说明可能的原因。
### 接下来怎么练
2–3 条具体可执行的建议（练哪类题、每天多少、用什么方法）。
错题挑重点讲，不用每题都展开；学习者追问某一题时再细讲那题。

## 工具
你能调用应用里的功能：lookup_word 查本机词典；add_to_vocab 加生词本；add_to_mistakes 把这套卷的题加进错题本；get_weak_points 看薄弱点；show_quiz 出能点选作答的练习题；update_profile 改写学习者档案；annotate_paper 在卷面上高亮、划线、标长难句并写释义。
- 学习者让你“标出来 / 划一下 / 把长难句标上 / 写个释义”时用 annotate_paper，一处调用一次；标完用一句话说标了哪些。
- 学习者说“记住……”、告诉你考试目标、日期或讲解偏好时，用 update_profile 写进档案（传完整的新档案，保留原有内容）。
- 学习者让你“记下 / 收藏 / 加进生词本 / 加进错题本”时直接调用工具，不要只口头答应。
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


def context_block(ctx: dict) -> str:
    parts = []
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
    if ctx.get("marks"):
        parts.append("学习者在卷面上的标注（高亮、划线、便签）：\n" + str(ctx["marks"])[:3000])
    if ctx.get("ink"):
        parts.append(
            "学习者的手写笔记（已从笔迹识别成文字，可能有个别字认错）。先读懂它们：他圈了哪些词、写了什么释义、可能卡在哪；"
            "被问到笔记时归纳成几条要点，别逐条照念：\n" + str(ctx["ink"])[:3000]
        )
    if ctx.get("paperText"):
        parts.append("这套卷的原文（按页，从卷面文字层取；扫描卷可能有个别识别错字，按上下文理解）。问到某题时直接从这里找题目、选项和文章：\n" + str(ctx["paperText"])[:30000])
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
    _fn("add_to_vocab", "把单词加进学习者的生词本（同时进入背词卡片）。学习者说要记、要收藏某个词时用。", {"word": {"type": "string"}, "sentence": {"type": "string", "description": "这个词出现的原句，可选"}}, ["word"]),
    _fn("add_to_mistakes", "把当前这套卷的某道选择题加进错题本，可附一句错因笔记。只在做题页（有试卷）时可用。", {"number": {"type": "integer", "description": "题号"}, "note": {"type": "string", "description": "错因或要点，可选"}}, ["number"]),
    _fn(
        "update_profile",
        "改写学习者档案（长期记忆）。学习者让你“记住”什么、或说出考试目标/日期/偏好时用。传入改写后的完整档案，栏目同系统提示里的档案。",
        {"profile": {"type": "string", "description": "完整的新档案（Markdown，栏目：考试目标、语法弱项、词汇弱项、题型表现、讲解偏好、最近在练）"}},
        ["profile"],
    ),
    _fn(
        "annotate_paper",
        "在学习者的卷面上做标注（会显示 AI 角标）：高亮、划线、标长难句，可以在旁边写一句释义。text 用卷面上的原文（原词原句，可以只给开头几个词）。",
        {
            "text": {"type": "string", "description": "要标的原文，照抄卷面；只给要标的那几个词（标短语就只给短语，标长难句才给整句）"},
            "style": {"type": "string", "enum": ["highlight", "underline", "long_sentence"], "description": "highlight 高亮重点词句；underline 划线；long_sentence 标长难句"},
            "note": {"type": "string", "description": "写在旁边的释义或要点，简短，可选"},
            "page": {"type": "integer", "description": "第几页，可选"},
        },
        ["text", "style"],
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
def upstream(cfg: dict, messages: list[dict], stream: bool, max_tokens: int = 1800, temperature: float | None = None, model: str | None = None, tools: list | None = None):
    url = cfg["base_url"].rstrip("/") + "/chat/completions"
    body = {"model": model or cfg["model"], "messages": messages, "stream": stream, "max_tokens": max_tokens}
    if tools:
        body["tools"] = tools
    t = cfg.get("temperature") if temperature is None else temperature
    if t is not None:
        body["temperature"] = t
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {cfg.get('api_key', '')}")
    req.add_header("User-Agent", "yingyu-agent/1.0")  # 不少接口在 Cloudflare 后面，默认的 Python-urllib 会被拦（1010）
    return urllib.request.urlopen(req, timeout=90)


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
                with upstream(cfg, [{"role": "user", "content": "用一句中文说：连接成功"}], False, 40) as r:
                    reply = json.load(r)["choices"][0]["message"]["content"]
                return self.send_json(200, {"ok": True, "reply": reply, "ms": int((time.time() - t0) * 1000)})
            except Exception as e:  # noqa: BLE001
                return self.send_json(502, {"error": upstream_error(e)})
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
        if path == "/api/agent/remember":
            return self.remember(cfg, data)
        self.send_json(404, {"error": "not found"})

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
            with upstream(cfg, msgs, False, 300, 0, model=vision) as r:
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
        ctx = context_block(data.get("context") or {})
        if ctx:
            sys_msg += "\n\n" + ctx
        try:
            pick = data.get("model") if data.get("model") in models(cfg) else None
            r = upstream(cfg, [{"role": "system", "content": sys_msg}, *turns], True, model=pick, tools=TOOLS if data.get("tools") else None)
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
            with upstream(cfg, msgs, False, 1600, 0) as r:
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
</main><script>
const $=id=>document.getElementById(id);
async function api(p,o={}){const r=await fetch(p,{credentials:"same-origin",headers:{"Content-Type":"application/json"},...o});let d={};try{d=await r.json()}catch{}return[r.status,d]}
function say(t,ok){$("msg").textContent=t;$("msg").className=ok?"ok":"err"}
async function boot(){const[s,d]=await api("/api/admin/config");if(s===401){$("login").hidden=false;$("form").hidden=true;$("pw").focus();return}
$("login").hidden=true;$("form").hidden=false;$("base_url").value=d.base_url||"";$("model").value=d.model||"";$("temperature").value=d.temperature??"";
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
    main()
