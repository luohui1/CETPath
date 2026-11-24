// 长难句层的单测：node --test src/lib/syntax.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { findSyntax, locate, syntaxRuns } from "./syntax.ts";
import { sentenceKey } from "./trans.ts";

const en = "It is the quality of daily life, rather than the size of the payment, that ultimately determines whether newcomers decide to stay.";
const e = {
  group: "rc2",
  en,
  main: [
    { t: "It is", r: "谓语" },
    { t: "the quality of daily life", r: "表语" },
  ],
  parts: [
    { t: "rather than the size of the payment", r: "插入语" },
    { t: "whether newcomers decide to stay", r: "宾语从句" },
  ],
  points: ["强调句"],
  zh: "……",
};

test("locate：整词、大小写和空白不计（同 build_syntax.py 的 find_ci）", () => {
  assert.deepEqual(locate("This is it.", "is"), [5, 7]);
  assert.deepEqual(locate("A  Big\ncat", "big cat"), [3, 10]);
  assert.deepEqual(locate("Don’t go", "don't"), [0, 5]);
  assert.equal(locate("this", "is"), null);
});

test("syntaxRuns：切开后拼回原句，主干和括号对得上", () => {
  const runs = syntaxRuns(e);
  assert.equal(runs.map((r) => r.text).join(""), en);
  assert.deepEqual(
    runs.filter((r) => r.main).map((r) => [r.text, r.main]),
    [
      ["It is", "谓语"],
      ["the quality of daily life", "表语"],
    ],
  );
  assert.equal(runs.find((r) => r.opens.includes(0)).text, "rather than the size of the payment");
  assert.ok(runs.find((r) => r.closes.includes(1)).text.endsWith("stay"));
});

test("findSyntax：按句子键找，标点空白不同也找得到", () => {
  const file = { id: "x", by: "ai", version: 1, sentences: { [sentenceKey(en)]: e } };
  assert.equal(findSyntax(file, en.replace(/,/g, " ").toUpperCase()), e);
  assert.equal(findSyntax(file, "Another sentence."), null);
  assert.equal(findSyntax(null, en), null);
});
