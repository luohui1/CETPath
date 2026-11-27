import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildClozeTokens,
  buildPhraseChunks,
  diffSpokenWords,
  isAnswerMatch,
  normalizeAnswerWord,
} from "./cloze.ts";

test("normalizeAnswerWord：处理大小写、标点、撇号与常见英美拼写", () => {
  assert.equal(normalizeAnswerWord("  Ultra-"), "ultra");
  assert.equal(normalizeAnswerWord("We’ve,"), "we've");
  assert.equal(normalizeAnswerWord("colour"), normalizeAnswerWord("color"));
  assert.equal(normalizeAnswerWord("organise"), normalizeAnswerWord("organize"));
  assert.equal(normalizeAnswerWord("centre"), normalizeAnswerWord("center"));
  assert.equal(normalizeAnswerWord("promise"), "promise");
  assert.equal(isAnswerMatch("Organised", "organized"), true);
});

test("buildClozeTokens：light 跳过虚词与专有名词，三档比例与确定性符合预期", () => {
  const s = "Now, Professor Oppenheimer found that creative researchers use constraints wisely.";
  const tLight1 = buildClozeTokens(s, "cet6-2024-06-1:pass2:1", "light");
  const tLight2 = buildClozeTokens(s, "cet6-2024-06-1:pass2:1", "light");
  assert.deepEqual(tLight1, tLight2);
  assert.equal(tLight1.map((t) => t.text).join(""), s);

  const lightBlanks = tLight1.filter((t) => t.blank);
  assert.ok(lightBlanks.length >= 1 && lightBlanks.length <= 5);
  assert.equal(
    lightBlanks.some((t) => t.word === "Oppenheimer" || t.word === "that"),
    false,
  );

  const tMed = buildClozeTokens(s, "cet6-2024-06-1:pass2:1", "medium");
  const tFull = buildClozeTokens(s, "cet6-2024-06-1:pass2:1", "full");
  assert.ok(tMed.filter((t) => t.blank).length >= lightBlanks.length);
  assert.equal(
    tFull.filter((t) => t.word && !t.blank).length,
    0,
  );

  // 全虚词短句也能保底挖出至少 1 空
  const shortTokens = buildClozeTokens("Is that so?", "seed", "light");
  assert.ok(shortTokens.filter((t) => t.blank).length >= 1);
});

test("buildPhraseChunks：合理分块、打乱且可还原原句", () => {
  const s = "When people face scarcity, they give themselves the freedom to use resources in novel ways.";
  const chunks = buildPhraseChunks(s, "cet6-2024-06-1:pass2:12");
  assert.ok(chunks.length >= 3 && chunks.length <= 8);
  assert.ok(chunks.some((c, i) => c.order !== i));

  const restored = [...chunks]
    .sort((a, b) => a.order - b.order)
    .map((c) => c.text)
    .join(" ");
  assert.equal(restored, s);

  // 短句兜底
  const shortChunks = buildPhraseChunks("Good morning.", "s1");
  assert.equal(shortChunks.length, 2);
  assert.ok(shortChunks.some((c, i) => c.order !== i));
});

test("diffSpokenWords：LCS 词级对齐与打分", () => {
  const full = diffSpokenWords(
    "Human creativity benefits from constraints.",
    "Human creativity benefits from constraints",
  );
  assert.equal(full.score, 100);
  assert.equal(full.hitCount, 5);

  const partial = diffSpokenWords(
    "You may feel as if you are an independent individual.",
    "you feel as if you are independent",
  );
  assert.equal(partial.total, 10);
  assert.equal(partial.hitCount, 7);
  assert.equal(partial.score, 70);
  assert.equal(partial.items[1].hit, false); // may
  assert.equal(partial.items[7].hit, false); // an
  assert.equal(partial.items[9].hit, false); // individual

  const empty = diffSpokenWords("Hello world.", "");
  assert.equal(empty.score, 0);
  assert.equal(empty.hitCount, 0);
});
