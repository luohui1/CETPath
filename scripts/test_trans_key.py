"""trans_key 单测：python -I scripts/test_trans_key.py

期望值和 src/lib/trans.ts 的单测用同一组：两边算出同一个键，界面才能按键找到译文。
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from trans_key import fnv1a32, trans_key, trans_norm  # noqa: E402


class TransKeyTest(unittest.TestCase):
    def test_norm(self):
        self.assertEqual(trans_norm("Hello,  World!"), "hello world")
        self.assertEqual(trans_norm("  It's 3 o'clock—now. "), "it s 3 o clock now")
        self.assertEqual(trans_norm("ＡＢＣ　１２３"), "abc 123")  # 全角经 NFKC 变成半角
        self.assertEqual(trans_norm("Café"), "caf")  # 非 ASCII 字母当分隔符
        self.assertEqual(trans_norm(""), "")

    def test_fnv1a(self):
        # FNV-1a 32 位的公开测试向量
        self.assertEqual(fnv1a32(b""), 0x811C9DC5)
        self.assertEqual(fnv1a32(b"a"), 0xE40C292C)
        self.assertEqual(fnv1a32(b"foobar"), 0xBF9CF968)

    def test_key(self):
        self.assertEqual(trans_key("Hello,  World!"), "d58b3fa7")
        self.assertEqual(trans_key("Hello,  World!"), trans_key("hello world"))
        self.assertEqual(trans_key("Hello,  World!"), trans_key("HELLO — world?"))
        self.assertEqual(len(trans_key("x")), 8)


if __name__ == "__main__":
    unittest.main()
