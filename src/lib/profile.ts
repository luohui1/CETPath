import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import { KIND_NAMES } from "./papers";

/**
 * Agent 的长期记忆 = 一份学习者档案（Markdown，栏目固定），存在本机 memory 表里 kind 为 "profile" 的那一行。
 * 每次聊完由模型改写；学习数据（正确率、错题、生词）不存，每次提问时从本机现算。
 */
export const PROFILE_SECTIONS = ["考试目标", "语法弱项", "词汇弱项", "题型表现", "讲解偏好", "最近在练"];
export const PROFILE_MAX = 1500;

const profileRow = async () => (await db.memory.toArray()).find((r) => r.kind === "profile");

/** 读档案；还没有档案但有旧的一条条记忆时，合并成档案（旧条目删掉） */
export async function getProfile(): Promise<string> {
  const rows = await db.memory.toArray();
  const p = rows.find((r) => r.kind === "profile");
  if (p) return p.text;
  const old = rows.filter((r) => r.kind !== "profile");
  if (!old.length) return "";
  const items = (k: string) => old.filter((r) => r.kind === k).map((r) => `- ${r.text}`).join("\n");
  const body: Record<string, string> = { 考试目标: items("fact"), 语法弱项: items("weak"), 讲解偏好: items("pref") };
  const text = PROFILE_SECTIONS.map((s) => `## ${s}\n${body[s] ?? ""}`.trim()).join("\n\n");
  await saveProfile(text);
  await db.memory.bulkDelete(old.map((r) => r.id!));
  return text;
}

export async function saveProfile(text: string) {
  const now = Date.now();
  const t = text.trim().slice(0, PROFILE_MAX * 2);
  await db.transaction("rw", db.memory, async () => {
    const row = await profileRow();
    if (row) await db.memory.update(row.id!, { text: t, updatedAt: now });
    else await db.memory.add({ kind: "profile", text: t, createdAt: now, updatedAt: now });
  });
}

export const clearProfile = async () => {
  const row = await profileRow();
  if (row) await db.memory.delete(row.id!);
};

export const useProfile = () => useLiveQuery(async () => (await profileRow())?.text ?? "", []);

/** 从本机数据现算的学习情况：最近交卷得分率、错题本按题型、生词数 */
export async function learningStats(): Promise<string> {
  const lines: string[] = [];
  const done = (await db.attempts.toArray()).filter((a) => a.submittedAt && a.total).sort((a, b) => b.submittedAt! - a.submittedAt!);
  if (done.length) {
    const recent = done.slice(0, 5);
    const rate = recent.reduce((s, a) => s + (a.score ?? 0) / a.total!, 0) / recent.length;
    lines.push(`交卷 ${done.length} 次；最近 ${recent.length} 次平均得分率 ${Math.round(rate * 100)}%`);
  }
  const mastery = await db.mastery.toArray();
  const open = new Map<string, number>();
  for (const r of mastery) if (!r.retiredAt) open.set(KIND_NAMES[r.kind] ?? r.kind, (open.get(KIND_NAMES[r.kind] ?? r.kind) ?? 0) + 1);
  if (open.size)
    lines.push(
      `错题本还没掌握：${[...open]
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k} ${n} 题`)
        .join("，")}`,
    );
  const retired = mastery.filter((r) => r.retiredAt).length;
  if (retired) lines.push(`已掌握移出错题本 ${retired} 题`);
  const vocab = await db.vocab.count();
  if (vocab) lines.push(`生词本 ${vocab} 个词`);
  return lines.join("\n");
}
