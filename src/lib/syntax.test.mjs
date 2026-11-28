// 长难句层的单测：node --test src/lib/syntax.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { findSyntax, locate, looksLikeEnglishSentence, parseAiSyntaxJson, sentenceMapToSyntaxEntry, syntaxRuns } from "./syntax.ts";
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

test("looksLikeEnglishSentence：中文问题不触发，英文长句触发", () => {
  assert.equal(looksLikeEnglishSentence("六级翻译怎么拆分长难句？"), false);
  assert.equal(looksLikeEnglishSentence("look up a phrase"), false);
  assert.equal(looksLikeEnglishSentence(en), true);
  assert.equal(looksLikeEnglishSentence("Scientists have long believed that sleep consolidates memory."), true);
});

test("parseAiSyntaxJson：解析代码围栏 JSON 并按原句位置校验主干与修饰", () => {
  const s = "Researchers who studied children found that early reading shapes adult fluency.";
  const raw = '说明如下：\n```json\n{"main":[{"t":"researchers","r":"主语"},{"t":"found","r":"谓语"},{"t":"that early reading shapes adult fluency","r":"宾语"}],"parts":[{"t":"who studied children","r":"定语从句","of":"researchers","note":"修饰研究人员"}],"points":["who 引导定语从句","that 引导宾语从句"],"zh":"研究儿童的研究人员发现，早期阅读塑造了成年后的流利度。"}\n```';
  const got = parseAiSyntaxJson(s, raw);
  assert.ok(got);
  assert.equal(got.main[0].t, "Researchers");
  assert.equal(got.main[1].t, "found");
  assert.equal(got.parts.length, 1);
  assert.equal(got.parts[0].r, "定语从句");
  assert.equal(got.points.length, 2);
  assert.match(got.zh, /早期阅读/);
  assert.equal(parseAiSyntaxJson(s, "not json"), null);
});

test("sentenceMapToSyntaxEntry：把 Agent 结构图数据转成 SyntaxEntry", () => {
  const s = "Although the policy was controversial, lawmakers passed it.";
  const got = sentenceMapToSyntaxEntry({
    sentence: s,
    translation: "尽管这项政策颇具争议，立法者还是通过了它。",
    parts: [
      { text: "Although the policy was controversial", role: "clause", level: 1, label: "让步状语从句，表示尽管", note: "点出争议" },
      { text: ",", role: "other", level: 0 },
      { text: "lawmakers", role: "subject", level: 0 },
      { text: "passed", role: "predicate", level: 0 },
      { text: "it", role: "object", level: 0 },
    ],
  });
  assert.ok(got);
  assert.deepEqual(got.main.map((m) => `${m.r}:${m.t}`), ["主语:lawmakers", "谓语:passed", "宾语:it"]);
  assert.equal(got.parts[0].r, "让步状语从句");
  assert.equal(got.parts[0].t, "Although the policy was controversial");
  assert.match(got.zh, /立法者/);
});
