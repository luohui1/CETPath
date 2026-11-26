#!/usr/bin/env python3
"""针对 server/agent_server.py 的多账户鉴权、开放注册开关、HEAD /api/auth/me 及 IELTS 同步表集成测试。"""
from __future__ import annotations

import http.client
import json
import pathlib
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))
import agent_server as srv  # noqa: E402


class TestAgentServerAuthAndSync(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        tdir = pathlib.Path(self.tmp.name)
        srv.CONFIG = str(tdir / "agent.json")
        srv.DB_PATH = str(tdir / "yingyu.db")
        srv._auth_hits.clear()
        srv._reg_hits.clear()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), srv.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tmp.cleanup()

    def req(self, method: str, path: str, body: dict | None = None, cookie: str | None = None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {}
        raw = None
        if body is not None:
            raw = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if cookie:
            headers["Cookie"] = cookie
        conn.request(method, path, body=raw, headers=headers)
        resp = conn.getresponse()
        data = resp.read()
        set_cookie = resp.getheader("Set-Cookie")
        conn.close()
        parsed = json.loads(data.decode()) if data else None
        return resp.status, parsed, set_cookie

    def test_auth_me_head_register_lock_and_ielts_sync(self) -> None:
        # 1. 未登录时 GET 与 HEAD /api/auth/me 均返回 401（配合 Caddy forward_auth）
        s_get, _, _ = self.req("GET", "/api/auth/me")
        s_head, body_head, _ = self.req("HEAD", "/api/auth/me")
        self.assertEqual(s_get, 401)
        self.assertEqual(s_head, 401)
        self.assertIsNone(body_head)

        # 2. 注册第一个账户 alice
        st, u1, sc1 = self.req("POST", "/api/auth/register", {"name": "alice", "password": "password123"})
        self.assertEqual(st, 200)
        self.assertEqual(u1["name"], "alice")
        uid1 = u1["uid"]
        sess1 = sc1.split(";", 1)[0]

        # 3. 持 Cookie 时 GET 与 HEAD /api/auth/me 均返回 200
        s_me, me_data, _ = self.req("GET", "/api/auth/me", cookie=sess1)
        s_me_head, _, _ = self.req("HEAD", "/api/auth/me", cookie=sess1)
        self.assertEqual(s_me, 200)
        self.assertEqual(s_me_head, 200)
        self.assertEqual(me_data["uid"], uid1)

        # 4. 关闭开放注册后，新用户注册返回 403，但已存在账户仍可正常登录
        srv.save({"allow_register": False})
        st_reg2, _, _ = self.req("POST", "/api/auth/register", {"name": "guest2", "password": "password123"})
        self.assertEqual(st_reg2, 403)
        st_login, u_login, _ = self.req("POST", "/api/auth/login", {"name": "alice", "password": "password123"})
        self.assertEqual(st_login, 200)
        self.assertEqual(u_login["uid"], uid1)

        # 5. 同步雅思三张表 + uid 防串号保护
        st_mismatch, _, _ = self.req("POST", "/api/sync", {"uid": uid1 + 99, "since": 0, "push": []}, cookie=sess1)
        self.assertEqual(st_mismatch, 409)

        push_items = [
            {"tbl": "ieltsAttempts", "k": "ia_1", "t": 100.0, "row": {"id": "ia_1", "paperId": "cam-C20-T1", "overallBand": 7.5}},
            {"tbl": "ieltsMastery", "k": "cam-C20-T1:reading:1", "t": 101.0, "row": {"id": "cam-C20-T1:reading:1", "unitKey": "1"}},
            {"tbl": "ieltsSpeaking", "k": "sp_1", "t": 102.0, "row": {"id": "sp_1", "done": True, "fav": True}},
        ]
        st_sync, sync_res, _ = self.req("POST", "/api/sync", {"uid": uid1, "since": 0, "push": push_items}, cookie=sess1)
        self.assertEqual(st_sync, 200)
        self.assertEqual(sync_res["seq"], 3)

        # 另一台设备拉取 since=0 能完整收到 3 条雅思记录
        st_pull, pull_res, _ = self.req("POST", "/api/sync", {"uid": uid1, "since": 0, "push": []}, cookie=sess1)
        self.assertEqual(st_pull, 200)
        self.assertEqual({x["tbl"] for x in pull_res["pull"]}, {"ieltsAttempts", "ieltsMastery", "ieltsSpeaking"})

        # 6. 校验 IELTS_GUIDES 识别
        self.assertEqual(srv.ielts_kind("第 15 题为什么是 NOT GIVEN", {"paper": "剑雅 C20 Test 1"}), "reading")
        self.assertEqual(srv.ielts_kind("Task 2 怎么展开", {"paper": "Writing Task 2"}), "writing")


if __name__ == "__main__":
    unittest.main()
