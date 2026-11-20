#!/usr/bin/env python3
# 外刊：删掉 index.json 里已经没有的文章文件（上传用 tar，删不掉过期文件）。超过 1 天没动的才删，免得和正在上传的撞上
# 服务器上装在 /usr/local/bin/yingyu-articles-gc，/etc/cron.d/yingyu-articles-gc 每天 7:30 跑
import json, os, time
D = "/srv/yingyu/articles-data"
try:
    keep = {a["id"] for a in json.load(open(os.path.join(D, "index.json")))}
except Exception:
    raise SystemExit(0)
if not keep:
    raise SystemExit(0)
old = time.time() - 86400
n = 0
for sub, ext in (("", ".json"), ("audio", ".mp3")):
    d = os.path.join(D, sub)
    for f in os.listdir(d) if os.path.isdir(d) else []:
        p = os.path.join(d, f)
        if f.endswith(ext) and f != "index.json" and f[: -len(ext)] not in keep and os.path.getmtime(p) < old:
            os.remove(p); n += 1
print("removed", n)
