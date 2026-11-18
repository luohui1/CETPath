// 译文层句子键的单测：node --test src/lib/trans.test.mjs（Node 22.18+ / 24 直接认 .ts）
// 期望值和 scripts/trans_key.py 的单测是同一组（用 Python 的 unicodedata + FNV-1a 另算出来的）
import { test } from "node:test";
import assert from "node:assert/strict";
import { findTrans, normSentence, sentenceKey } from "./trans.ts";

test("规范化：标点和多个空格并成一个空格，小写", () => {
  assert.equal(normSentence("Hello,  World!"), "hello world");
  assert.equal(normSentence("  “Café”—No. 3 ﬁne  "), "caf no 3 fine");
  assert.equal(normSentence("!!!"), "");
});

test("键：FNV-1a 32 位，8 位小写十六进制", () => {
  assert.equal(sentenceKey("Hello,  World!"), "d58b3fa7");
  assert.equal(sentenceKey("hello world"), "d58b3fa7");
  assert.equal(
    sentenceKey("Less than a month later, the Special Olympics spring games will return to Fayetteville."),
    "0c04c355",
  );
  assert.equal(sentenceKey(""), "811c9dc5");
  assert.match(sentenceKey("A"), /^[0-9a-f]{8}$/);
});

test("找译文：键对上就有，没有或文件缺失是 null", () => {
  const file = { id: "x", by: "ai", version: 1, sentences: { d58b3fa7: "你好，世界！" } };
  assert.equal(findTrans(file, "HELLO world."), "你好，世界！");
  assert.equal(findTrans(file, "Goodbye world."), null);
  assert.equal(findTrans(null, "Hello, World!"), null);
});
