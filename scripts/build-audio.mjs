// 根据听力原文合成听力音频（仅 Windows：用系统自带的 SAPI 语音合成），用于官方录音缺失的试卷。
// 读取 scripts/audio/<paperId>.json 里的台词，逐句合成、按停顿拼接，
// 输出 public/audio/<paperId>.mp3（没有 ffmpeg 时输出 .wav），
// 并把每段、每句的起止时间写回 public/papers/<paperId>.json 的 audio 字段。
// 用法：npm run build:audio
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RATE = 22050;
const BYTES_PER_SEC = RATE * 2; // 16 位单声道
const DEFAULT_PAUSE = 0.6;
const LEAD_IN = 0.5;

const PS_SCRIPT = `
param([string]$linesPath, [string]$outDir)
Add-Type -AssemblyName System.Speech
$lines = Get-Content -Raw -Encoding UTF8 $linesPath | ConvertFrom-Json
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(${RATE}, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$i = 0
foreach ($l in $lines) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try { $s.SelectVoice($l.voice) } catch { Write-Warning "voice not found: $($l.voice)" }
  $s.Rate = -1
  $s.SetOutputToWaveFile((Join-Path $outDir ("{0:D4}.wav" -f $i)), $fmt)
  $s.Speak($l.text)
  $s.Dispose()
  $i++
}
`;

/** 取出 WAV 文件里的 PCM 数据 */
function pcmOf(buf) {
  let p = 12;
  while (p < buf.length) {
    const id = buf.toString("ascii", p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === "data") return buf.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size % 2);
  }
  throw new Error("WAV 里没有 data 块");
}

function wavHeader(dataLen) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataLen, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // 单声道
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(BYTES_PER_SEC, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(dataLen, 40);
  return h;
}

const silence = (sec) => Buffer.alloc(Math.round(sec * RATE) * 2);
const round = (n) => Math.round(n * 100) / 100;

function hasFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function build(scriptFile) {
  const spec = JSON.parse(await readFile(scriptFile, "utf8"));
  const work = await mkdtemp(path.join(tmpdir(), "yyzd-audio-"));
  try {
    const flat = spec.segments.flatMap((s) => s.lines.map((l) => ({ voice: spec.voices[l.voice] ?? l.voice, text: l.text })));
    await writeFile(path.join(work, "lines.json"), JSON.stringify(flat));
    await writeFile(path.join(work, "gen.ps1"), "﻿" + PS_SCRIPT);
    console.log(`[${spec.paperId}] 合成 ${flat.length} 句…`);
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(work, "gen.ps1"), path.join(work, "lines.json"), work], { stdio: "inherit" });

    const chunks = [silence(LEAD_IN)];
    let t = LEAD_IN;
    let i = 0;
    const segments = [];
    for (const seg of spec.segments) {
      const start = t;
      const lines = [];
      for (const l of seg.lines) {
        const pcm = pcmOf(await readFile(path.join(work, `${String(i++).padStart(4, "0")}.wav`)));
        const dur = pcm.length / BYTES_PER_SEC;
        lines.push({ ...(l.speaker ? { speaker: l.speaker } : {}), text: l.text, start: round(t), end: round(t + dur) });
        chunks.push(pcm);
        t += dur;
        const pause = l.pause ?? DEFAULT_PAUSE;
        chunks.push(silence(pause));
        t += pause;
      }
      segments.push({ id: seg.id, label: seg.label, start: round(start), end: round(t), lines });
    }

    const data = Buffer.concat(chunks);
    const wavPath = path.join(work, "all.wav");
    await writeFile(wavPath, Buffer.concat([wavHeader(data.length), data]));
    const outDir = path.join(root, "public/audio");
    await mkdir(outDir, { recursive: true });
    let src;
    if (hasFfmpeg()) {
      src = `/audio/${spec.paperId}.mp3`;
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wavPath, "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "48k", path.join(outDir, `${spec.paperId}.mp3`)]);
    } else {
      src = `/audio/${spec.paperId}.wav`;
      await writeFile(path.join(outDir, `${spec.paperId}.wav`), await readFile(wavPath));
    }

    const paperPath = path.join(root, "public/papers", `${spec.paperId}.json`);
    const paper = JSON.parse(await readFile(paperPath, "utf8"));
    paper.audio = { src, duration: round(t), segments };
    await writeFile(paperPath, JSON.stringify(paper, null, 2) + "\n");
    console.log(`[${spec.paperId}] 完成：${src}，时长 ${Math.floor(t / 60)} 分 ${Math.round(t % 60)} 秒`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

const dir = path.join(root, "scripts/audio");
for (const f of await readdir(dir)) if (f.endsWith(".json")) await build(path.join(dir, f));
