import { useEffect, useState } from "react";
import Dexie, { type EntityTable } from "dexie";
import { IDBKeyRange as fakeIDBKeyRange, indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { ACTIVE_ACCOUNT, scopedKey } from "@/lib/account";
import { memoryDb } from "@/lib/db";

/**
 * 听说实训进度（存在 localStorage `yz-studio-progress:<scope>` 并由 src/lib/sync.ts 按账号跨设备同步）
 * 与独立录音库 `yingyu-studio-audio`（按账号隔离，不改动主库 db.ts schema）
 */
export interface DictationStat {
  bestAcc: number;
  mode: string;
  count: number;
  doneLines?: number[];
  updatedAt: number;
}

export interface ShadowingStat {
  doneLines: number;
  totalLines: number;
  bestScore: number;
  updatedAt: number;
}

export interface SpeakingStat {
  done: boolean;
  count: number;
  fav?: boolean;
  draft?: string;
  feedback?: string;
  updatedAt: number;
}

export interface StudioProgress {
  dictation: Record<string, DictationStat>;
  shadowing: Record<string, ShadowingStat>;
  speaking: Record<string, SpeakingStat>;
}

const RAW_PROGRESS_KEY = "yz-studio-progress";
const PROGRESS_KEY = scopedKey(RAW_PROGRESS_KEY);
const CHANGE_EVENT = "yz-studio-change";
const MAX_RECORDINGS_PER_TARGET = 5;

function emptyProgress(): StudioProgress {
  return { dictation: {}, shadowing: {}, speaking: {} };
}

export function readStudioProgress(): StudioProgress {
  try {
    let raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw && !ACTIVE_ACCOUNT) {
      raw = localStorage.getItem(RAW_PROGRESS_KEY);
      if (raw) {
        try {
          localStorage.setItem(PROGRESS_KEY, raw);
        } catch {
          // 忽略存储空间不足错误
        }
      }
    }
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw) as Partial<StudioProgress>;
    return {
      dictation: parsed.dictation && typeof parsed.dictation === "object" ? parsed.dictation : {},
      shadowing: parsed.shadowing && typeof parsed.shadowing === "object" ? parsed.shadowing : {},
      speaking: parsed.speaking && typeof parsed.speaking === "object" ? parsed.speaking : {},
    };
  } catch {
    return emptyProgress();
  }
}

export function writeStudioProgress(next: StudioProgress) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
  } catch {
    // 忽略存储空间不足错误，不阻断页面交互
  }
  dispatchEvent(new Event(CHANGE_EVENT));
}

export function patchDictationStat(key: string, acc: number, mode: string, doneLineIdx?: number) {
  const cur = readStudioProgress();
  const prev = cur.dictation[key];
  let doneLines = prev?.doneLines;
  if (typeof doneLineIdx === "number" && Number.isFinite(doneLineIdx)) {
    const s = new Set(doneLines ?? []);
    s.add(doneLineIdx);
    doneLines = [...s].sort((a, b) => a - b);
  }
  cur.dictation[key] = {
    bestAcc: Math.max(prev?.bestAcc ?? 0, Math.round(acc)),
    mode,
    count: (prev?.count ?? 0) + 1,
    ...(doneLines?.length ? { doneLines } : {}),
    updatedAt: Date.now(),
  };
  writeStudioProgress(cur);
}

export function patchShadowingStat(key: string, doneLines: number, totalLines: number, score?: number) {
  const cur = readStudioProgress();
  const prev = cur.shadowing[key];
  cur.shadowing[key] = {
    doneLines: Math.max(prev?.doneLines ?? 0, doneLines),
    totalLines,
    bestScore: Math.max(prev?.bestScore ?? 0, Math.round(score ?? 0)),
    updatedAt: Date.now(),
  };
  writeStudioProgress(cur);
}

export function patchSpeakingStat(id: string, patch: Partial<SpeakingStat>) {
  const cur = readStudioProgress();
  const prev = cur.speaking[id] ?? { done: false, count: 0, updatedAt: 0 };
  cur.speaking[id] = {
    ...prev,
    ...patch,
    updatedAt: Date.now(),
  };
  writeStudioProgress(cur);
}

export function useStudioProgress(): StudioProgress {
  const [state, setState] = useState<StudioProgress>(() => readStudioProgress());
  useEffect(() => {
    const sync = () => setState(readStudioProgress());
    addEventListener(CHANGE_EVENT, sync);
    addEventListener("storage", sync);
    return () => {
      removeEventListener(CHANGE_EVENT, sync);
      removeEventListener("storage", sync);
    };
  }, []);
  return state;
}

export interface StudioRecordingRow {
  id: string;
  targetKey: string;
  blob: Blob;
  mime: string;
  seconds: number;
  transcript?: string;
  score?: number;
  createdAt: number;
}

const STUDIO_AUDIO_DB = ACTIVE_ACCOUNT
  ? `yingyu-studio-audio:u${ACTIVE_ACCOUNT.uid}`
  : "yingyu-studio-audio";

const studioAudioDb = new Dexie(
  STUDIO_AUDIO_DB,
  memoryDb ? { indexedDB: fakeIndexedDB, IDBKeyRange: fakeIDBKeyRange } : undefined,
) as Dexie & {
  recordings: EntityTable<StudioRecordingRow, "id">;
};

studioAudioDb.version(1).stores({
  recordings: "id, targetKey, createdAt",
});

export function makeRecordingId(prefix = "rec"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function listRecordings(targetKey: string): Promise<StudioRecordingRow[]> {
  try {
    return await studioAudioDb.recordings.where("targetKey").equals(targetKey).sortBy("createdAt");
  } catch {
    return [];
  }
}

export async function listRecordingsByPrefix(prefix: string): Promise<StudioRecordingRow[]> {
  try {
    return await studioAudioDb.recordings
      .where("targetKey")
      .startsWith(prefix)
      .sortBy("createdAt");
  } catch {
    return [];
  }
}

export async function saveRecording(row: StudioRecordingRow): Promise<StudioRecordingRow[]> {
  await studioAudioDb.recordings.put(row);
  const all = await listRecordings(row.targetKey);
  if (all.length > MAX_RECORDINGS_PER_TARGET) {
    const obsolete = all.slice(0, all.length - MAX_RECORDINGS_PER_TARGET);
    await studioAudioDb.recordings.bulkDelete(obsolete.map((x) => x.id));
    return all.slice(all.length - MAX_RECORDINGS_PER_TARGET);
  }
  return all;
}

export async function deleteRecording(id: string): Promise<void> {
  await studioAudioDb.recordings.delete(id);
}

export function readStudioProgressRaw(): StudioProgress {
  return readStudioProgress();
}

export function writeStudioProgressRaw(data: Partial<StudioProgress> | null | undefined): void {
  if (!data || typeof data !== "object") {
    try {
      localStorage.removeItem(PROGRESS_KEY);
      if (!ACTIVE_ACCOUNT) localStorage.removeItem(RAW_PROGRESS_KEY);
    } catch {
      // 忽略
    }
    dispatchEvent(new Event(CHANGE_EVENT));
    return;
  }
  writeStudioProgress({
    dictation: data.dictation && typeof data.dictation === "object" ? data.dictation : {},
    shadowing: data.shadowing && typeof data.shadowing === "object" ? data.shadowing : {},
    speaking: data.speaking && typeof data.speaking === "object" ? data.speaking : {},
  });
}

export async function clearStudioData(): Promise<void> {
  writeStudioProgressRaw(null);
  try {
    await studioAudioDb.recordings.clear();
  } catch {
    // 忽略
  }
}
