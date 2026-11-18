"""句子译文层的键（和 src/lib/trans.ts 同一个算法，见 docs/设计任务-I轮-听力与译文与小窗.md §0.1）。

    norm = text.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    key  = FNV-1a 32 位（norm 的 UTF-8 字节，此时只有 ASCII），8 位小写十六进制

卷面句子来自 public/papers/pdf/<id>.words.json 的 pages[].s，听力句子来自试卷 JSON 的
audio.segments[].lines[].text，两边都用 trans_key() 算键。

单测：python -I scripts/test_trans_key.py
"""
import re
import unicodedata

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
FNV_OFFSET = 0x811C9DC5
FNV_PRIME = 0x01000193


def trans_norm(text: str) -> str:
    t = unicodedata.normalize("NFKC", text or "").lower()
    return _NON_ALNUM.sub(" ", t).strip()


def fnv1a32(data: bytes) -> int:
    h = FNV_OFFSET
    for b in data:
        h ^= b
        h = (h * FNV_PRIME) & 0xFFFFFFFF
    return h


def trans_key(text: str) -> str:
    return format(fnv1a32(trans_norm(text).encode("utf-8")), "08x")


if __name__ == "__main__":
    import sys
    for arg in sys.argv[1:] or ["Hello,  World!"]:
        print(trans_key(arg), trans_norm(arg))
