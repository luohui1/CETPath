// 口音选声的单测：node --test src/lib/voice.test.mjs（Node 22.18+ / 24 直接认 .ts）
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCENT_LANG, chooseVoice, voiceMatchesAccent } from "./voice.ts";

const voice = (voiceURI, name, lang) => ({ voiceURI, name, lang });

test("美音有 en-US 时选 en-US，不选 en-GB", () => {
  const us = voice("us-1", "Microsoft Zira", "en-US");
  const uk = voice("uk-1", "Microsoft Hazel", "en-GB");
  assert.equal(chooseVoice([uk, us], null, "us"), us);
});

test("英音有 en-GB 时选 en-GB，不选 en-US", () => {
  const us = voice("us-1", "Microsoft Zira", "en-US");
  const uk = voice("uk-1", "Microsoft Hazel", "en-GB");
  assert.equal(chooseVoice([us, uk], null, "uk"), uk);
});

test("显式选过发音人：口音对得上就用它，对不上按设置改选", () => {
  const us = voice("us-1", "Microsoft Zira", "en-US");
  const uk = voice("uk-1", "Microsoft Hazel", "en-GB");
  assert.equal(chooseVoice([us, uk], "us-1", "us"), us);
  assert.equal(chooseVoice([us, uk], "uk-1", "us"), us);
  assert.equal(chooseVoice([us, uk], "us-1", "uk"), uk);
});

test("同口音优先 natural / online 语音", () => {
  const plain = voice("us-1", "Microsoft David", "en-US");
  const natural = voice("us-2", "Microsoft Aria Online (Natural)", "en-US");
  assert.equal(chooseVoice([plain, natural], null, "us"), natural);
});

test("没有对应口音时退回任意英语语音", () => {
  const au = voice("au-1", "Karen", "en-AU");
  assert.equal(chooseVoice([au], null, "us"), au);
});

test("没有英语语音时返回 undefined，不拿中文语音读英文", () => {
  const zh = voice("zh-1", "Microsoft Huihui", "zh-CN");
  assert.equal(chooseVoice([zh], "zh-1", "us"), undefined);
});

test("空语音列表返回 undefined", () => {
  assert.equal(chooseVoice([], null, "us"), undefined);
});

test("语言标签大小写、下划线和带后缀的写法都能认", () => {
  const us = voice("us-1", "Zira", "EN_us");
  assert.equal(chooseVoice([us], null, "us"), us);
  assert.equal(voiceMatchesAccent("en-US", "us"), true);
  assert.equal(voiceMatchesAccent("en_US", "us"), true);
  assert.equal(voiceMatchesAccent("en-GB-oxendict", "uk"), true);
  assert.equal(voiceMatchesAccent("en-GB", "us"), false);
  assert.equal(ACCENT_LANG.us, "en-US");
  assert.equal(ACCENT_LANG.uk, "en-GB");
});

test("备份里出现非法口音值时按美音兜底，不抛异常", () => {
  const us = voice("us-1", "Zira", "en-US");
  assert.equal(chooseVoice([us], null, "xx"), us);
});
