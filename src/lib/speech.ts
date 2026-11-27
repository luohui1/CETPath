import { useEffect, useState } from "react";
import { getSettings } from "./settings";
import { ACCENT_LANG, chooseVoice, type Accent } from "./voice";

/*
 * 发音：词书里的词播提前下载好的有道真人录音（public/audio/words，scripts/fetch_word_audio.py 下载），
 * 其他词和短句在线播有道发音（playYoudao），没网时才用浏览器自带的语音合成。
 */

/** 录音文件名：小写，字母数字以外的字符换成 _（和下载脚本里的 slug 一致） */
export const wordSlug = (word: string) =>
  word
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

let recorded: Promise<Record<Accent, Set<string>>> | null = null;

/** 有哪些词有真人录音（只加载一次；没下载过就是空的） */
function recordedWords() {
  recorded ??= fetch("/audio/words/index.json")
    .then((r): Promise<Partial<Record<Accent, string[]>>> => (r.ok ? r.json() : Promise.resolve({})))
    .catch((): Partial<Record<Accent, string[]>> => ({}))
    .then((idx) => ({ us: new Set(idx.us ?? []), uk: new Set(idx.uk ?? []) }));
  return recorded;
}

/*
 * 全程只用一个 <audio>，换 src 再播：iPad 的 Safari 要求"点了才能出声"，每次新建的播放器在点击之后隔了几步异步
 * （查设置、查词表）就可能被拦下；同一个播放器只要被点着播过一次，之后换 src 再播都放行
 */
let player: HTMLAudioElement | null = null;
const getPlayer = () => (player ??= new Audio());
let audioOwner = 0; // 当前这段播放属于哪次 speak：旧请求失败时不能去 pause 掉新请求的声音

/** 换 src 播一段；timeout 毫秒内没开始播就算失败 */
async function playUrl(url: string, rate: number, timeout = 0, owner = 0) {
  const p = getPlayer();
  audioOwner = owner;
  p.pause();
  p.src = url;
  // 录音本来就是正常语速，只在要求慢读时放慢
  p.playbackRate = Math.min(1, rate / 0.9);
  try {
    const go = p.play();
    await (timeout ? Promise.race([go, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeout))]) : go);
    return true;
  } catch {
    if (audioOwner === owner) p.pause();
    return false;
  }
}

/** 播一个词的真人录音；没有这个词的录音或者播放失败返回 false */
async function playRecording(text: string, accent: Accent, rate: number, alive: () => boolean, owner: number) {
  const slug = wordSlug(text);
  if (!slug || slug.length > 40) return false;
  const sets = await recordedWords();
  if (!alive()) return false; // 等录音表的时候又点了别的词：这次别再出声
  // 只播所选口音的录音；没有就走在线/系统语音，不能静默换成另一种口音
  if (!sets[accent].has(slug)) return false;
  return playUrl(`/audio/words/${accent}/${slug}.mp3`, rate, 0, owner);
}

/**
 * 词书外的词（变形、人名）和短句：在线播有道的发音（和词书录音同一个来源，国内直连快）。
 * 非官方接口：自用可以，给别人用之前要换成有授权的来源（见 scripts/fetch_word_audio.py）。没网或播放失败返回 false
 */
const YOUDAO_MAX = 160;
async function playYoudao(text: string, accent: Accent, rate: number, owner: number) {
  if (text.length > YOUDAO_MAX || (typeof navigator !== "undefined" && navigator.onLine === false)) return false;
  // 网络卡住时别一直等：3 秒还没开始播就算失败，退回系统语音
  return playUrl(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=${accent === "us" ? 2 : 1}`, rate, 3000, owner);
}

/** 浏览器自带的语音合成：有道也播不了（没网）时才用 */
export function speechSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function englishVoices(): SpeechSynthesisVoice[] {
  if (!speechSupported()) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
}

export function useEnglishVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(englishVoices);
  useEffect(() => {
    if (!speechSupported()) return;
    const update = () => setVoices(englishVoices());
    speechSynthesis.addEventListener("voiceschanged", update);
    update();
    return () => speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);
  return voices;
}

/** 第一次点发音时 Chrome 的 getVoices() 可能还是空的：等 voiceschanged，最多 1 秒；只等一次 */
let voicesWait: Promise<void> | null = null;
function voicesReady(timeout = 1000) {
  if (!speechSupported() || speechSynthesis.getVoices().length) return Promise.resolve();
  voicesWait ??= new Promise<void>((resolve) => {
    let timer = 0;
    const done = () => {
      speechSynthesis.removeEventListener("voiceschanged", done);
      clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(done, timeout);
    speechSynthesis.addEventListener("voiceschanged", done);
  });
  return voicesWait;
}

function pickVoice(uri: string | null, accent: Accent) {
  return chooseVoice(englishVoices(), uri, accent);
}

let seq = 0; // 每点一次发音加一：异步试播期间又点了别的词，这次就不再出声

/** 读出一个词或一句话：词书里的词播下载好的有道录音，其余在线播有道发音，都不行才用系统语音合成 */
export async function speak(text: string, rate = 0.9) {
  text = text.trim();
  if (!text) return;
  const mine = ++seq;
  const s = await getSettings();
  if (mine !== seq) return;
  // 备份/旧数据里的口音值只可能是 us/uk，兜底按美音，别让发音整个失效
  const voiceURI = s.voiceURI;
  const accent: Accent = s.accent === "uk" ? "uk" : "us";
  if (speechSupported()) speechSynthesis.cancel();
  if (/^[a-z][a-z.'\- ]*$/i.test(text) && (await playRecording(text, accent, rate, () => mine === seq, mine))) return;
  if (mine !== seq) return;
  if (await playYoudao(text, accent, rate, mine)) return;
  if (mine !== seq || !speechSupported()) return;
  player?.pause();
  await voicesReady();
  if (mine !== seq) return;
  const u = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(voiceURI, accent);
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? ACCENT_LANG[accent];
  u.rate = rate;
  speechSynthesis.speak(u);
}
