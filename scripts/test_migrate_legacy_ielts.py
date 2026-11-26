#!/usr/bin/env python3
"""针对 scripts/migrate_legacy_ielts.py 的单元测试（覆盖整套模考合并、单科记录、错题回填、口语进度与重复执行幂等性）。"""
from __future__ import annotations

import json
import pathlib
import sqlite3
import tempfile
import unittest

import migrate_legacy_ielts as mig

ROOT = pathlib.Path(__file__).resolve().parent.parent


class TestMigrateLegacyIelts(unittest.TestCase):
    def _make_legacy_sqlite(self, path: pathlib.Path) -> None:
        conn = sqlite3.connect(path)
        conn.executescript(
            """
            CREATE TABLE records (
                c TEXT NOT NULL,
                id TEXT NOT NULL,
                u INTEGER NOT NULL,
                d INTEGER NOT NULL DEFAULT 0,
                v TEXT,
                seq INTEGER NOT NULL,
                PRIMARY KEY (c, id)
            );
            """
        )
        t0 = 1_760_000_000_000
        records = [
            (
                "attempts",
                "a_l1",
                t0 + 1000,
                0,
                json.dumps({
                    "id": "a_l1",
                    "pid": "cam-C20-T1",
                    "skill": "listening",
                    "mode": "exam",
                    "family": "cam",
                    "title": "C20 Test 1",
                    "startedAt": t0,
                    "finishedAt": t0 + 1000,
                    "status": "submitted",
                    "answers": {"1": "wrong_answer"},
                    "flags": {"2": True},
                    "essays": {},
                    "hl": {},
                    "elapsed": 1500,
                    "result": {"raw": 32, "total": 40, "band": 7.5, "reason": "manual", "elapsed": 1500},
                }),
                1,
            ),
            (
                "attempts",
                "a_r1",
                t0 + 2000,
                0,
                json.dumps({
                    "id": "a_r1",
                    "pid": "cam-C20-T1",
                    "skill": "reading",
                    "mode": "exam",
                    "family": "cam",
                    "title": "C20 Test 1",
                    "startedAt": t0 + 1000,
                    "finishedAt": t0 + 2000,
                    "status": "submitted",
                    "answers": {"1": "FALSE"},
                    "flags": {},
                    "essays": {},
                    "hl": {"p0": ["quote"]},
                    "elapsed": 3200,
                    "result": {"raw": 35, "total": 40, "band": 8.0, "reason": "manual", "elapsed": 3200},
                }),
                2,
            ),
            (
                "attempts",
                "a_w1",
                t0 + 3000,
                0,
                json.dumps({
                    "id": "a_w1",
                    "pid": "cam-C20-T1",
                    "skill": "writing",
                    "mode": "exam",
                    "family": "cam",
                    "title": "C20 Test 1",
                    "startedAt": t0 + 2000,
                    "finishedAt": t0 + 3000,
                    "status": "submitted",
                    "answers": {},
                    "flags": {},
                    "essays": {"1": "The chart illustrates...", "2": "In contemporary society..."},
                    "hl": {},
                    "elapsed": 3500,
                    "result": {"words": {"1": 165, "2": 280}, "reason": "manual", "elapsed": 3500},
                }),
                3,
            ),
            (
                "kv",
                "mock:m1",
                t0 + 3000,
                0,
                json.dumps({
                    "k": "mock:m1",
                    "v": {
                        "id": "m1",
                        "pid": "cam-C20-T1",
                        "title": "C20 Test 1",
                        "family": "cam",
                        "skills": ["listening", "reading", "writing"],
                        "steps": {"listening": "a_l1", "reading": "a_r1", "writing": "a_w1"},
                        "status": "done",
                        "startedAt": t0,
                        "finishedAt": t0 + 3000,
                    },
                }),
                4,
            ),
            (
                "attempts",
                "a_solo",
                t0 + 5000,
                0,
                json.dumps({
                    "id": "a_solo",
                    "pid": "cam-C19-T1",
                    "skill": "reading",
                    "mode": "practice",
                    "family": "cam",
                    "title": "C19 Test 1",
                    "startedAt": t0 + 4000,
                    "status": "active",
                    "answers": {"1": "TRUE"},
                    "flags": {},
                    "essays": {},
                    "hl": {},
                    "elapsed": 420,
                }),
                5,
            ),
            (
                "kv",
                "speaking:progress",
                t0 + 6000,
                0,
                json.dumps({
                    "k": "speaking:progress",
                    "v": {
                        "q_101": {"done": True, "fav": True, "count": 2, "lastAt": t0 + 6000},
                        "q_empty": {"done": False, "fav": False, "count": 0},
                    },
                }),
                6,
            ),
        ]
        conn.executemany("INSERT INTO records VALUES (?,?,?,?,?,?)", records)
        conn.commit()
        conn.close()

    def test_full_migration_and_idempotency(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tdir = pathlib.Path(tmp)
            legacy_db = tdir / "sync.sqlite3"
            target_db = tdir / "yingyu.db"
            self._make_legacy_sqlite(legacy_db)

            attempts, kv = mig.load_legacy_source(legacy_db)
            rows, day_deltas = mig.build_migration_rows(attempts, kv, ROOT / "public" / "ielts")

            res1 = mig.apply_to_yingyu_db(target_db, "alice", None, "secret123", rows, day_deltas, "unit")
            self.assertGreater(res1["written"], 3)
            self.assertEqual(res1["skipped"], 0)
            self.assertEqual(res1["days_written"], 1)

            # 第二次执行完全幂等：written=0，days_written=0，seq 不变
            res2 = mig.apply_to_yingyu_db(target_db, "alice", None, "secret123", rows, day_deltas, "unit")
            self.assertEqual(res2["written"], 0)
            self.assertEqual(res2["days_written"], 0)
            self.assertEqual(res2["seq"], res1["seq"])

            conn = sqlite3.connect(target_db)
            mock_raw = conn.execute(
                "SELECT data FROM rows WHERE uid=? AND tbl='ieltsAttempts' AND k='legacy_mock_m1'",
                (res1["uid"],),
            ).fetchone()[0]
            mock_obj = json.loads(mock_raw)
            self.assertEqual(mock_obj["scope"], "full")
            self.assertEqual(mock_obj["mode"], "mock")
            # (7.5 + 8.0) / 2 = 7.75 -> IELTS 0.5 进位为 8.0
            self.assertEqual(mock_obj["overallBand"], 8.0)

            solo_raw = conn.execute(
                "SELECT data FROM rows WHERE uid=? AND tbl='ieltsAttempts' AND k='legacy_a_solo'",
                (res1["uid"],),
            ).fetchone()[0]
            solo_obj = json.loads(solo_raw)
            self.assertEqual(solo_obj["scope"], "reading")
            self.assertEqual(solo_obj["mode"], "practice")
            self.assertNotIn("submittedAt", solo_obj)

            sp_count = conn.execute(
                "SELECT COUNT(*) FROM rows WHERE uid=? AND tbl='ieltsSpeaking'",
                (res1["uid"],),
            ).fetchone()[0]
            self.assertEqual(sp_count, 1)

            mastery_count = conn.execute(
                "SELECT COUNT(*) FROM rows WHERE uid=? AND tbl='ieltsMastery'",
                (res1["uid"],),
            ).fetchone()[0]
            self.assertGreater(mastery_count, 0)
            conn.close()


if __name__ == "__main__":
    unittest.main()
