"""预览版（纯静态，没有后台）用：把 Agent 后台的系统提示词和工具定义导出到 public/agent-prompts.json，浏览器直接拿去调模型"""
import json
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / "server"))
import agent_server as a  # noqa: E402

out = {
    "system": a.SYSTEM,
    "longGuide": a.LONG_GUIDE,
    "cetGuides": a.CET_GUIDES,
    "cetWords": a._CET_WORDS,
    "remember": a.REMEMBER,
    "tools": a.TOOLS,
}
p = root / "public" / "agent-prompts.json"
p.write_text(json.dumps(out, ensure_ascii=False), "utf-8")
print("写好", p.relative_to(root))
