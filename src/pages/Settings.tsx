import { useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { MEMORY_KINDS } from "@/lib/agent";
import { DownloadSimple, SpeakerHigh, Trash, UploadSimple } from "@phosphor-icons/react";
import { clearAll, exportBackup, importBackup } from "@/lib/backup";
import { setSetting, useSettings } from "@/lib/settings";
import { speak, speechSupported, useEnglishVoices } from "@/lib/speech";
import { downloadText } from "@/lib/utils";
import { StickyTab } from "@/components/paper-ui";
import { Button, Card, PageHeader, Segmented, Switch } from "@/components/ui";

function Row({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-[64px] flex-wrap items-center justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0">
        <div className="text-[15px] font-medium">{title}</div>
        {desc && <div className="mt-0.5 text-[13px] text-[var(--ink-500)]">{desc}</div>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function Group({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-7 scroll-mt-6">
      {/* 分组标题是一张从卡片上沿伸出的便签 */}
      <h2 className="ml-4">
        <StickyTab>{title}</StickyTab>
      </h2>
      <Card className="divide-y divide-[var(--line-soft)]">{children}</Card>
    </section>
  );
}

export function SettingsPage() {
  const s = useSettings();
  const voices = useEnglishVoices();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const doExport = async () => {
    const data = await exportBackup();
    downloadText(`英语之道-备份-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), "application/json");
    setMsg("备份文件已下载");
  };

  const doImport = async (file: File) => {
    try {
      const json = JSON.parse(await file.text());
      if (!confirm("导入会覆盖当前所有学习数据，确定继续吗？")) return;
      await importBackup(json);
      setMsg("导入成功");
    } catch (e) {
      setMsg(`导入失败：${(e as Error).message}`);
    }
  };

  const doClear = async () => {
    if (!confirm("清空生词本、背词记录、做题记录和设置？此操作不能撤销。")) return;
    if (!confirm("再确认一次：真的要清空所有数据吗？建议先导出备份。")) return;
    await clearAll();
    setMsg("已清空所有数据");
  };

  return (
    <div className="max-w-2xl">
      <PageHeader title="设置" />

      <Group title="做题">
        <Row title="整套卷的做题方式" desc="新开一套时直接用这个方式；普通做题还没动笔时，也能在顶栏改成全真模拟">
          <Segmented
            label="整套卷的做题方式"
            value={s.examMode}
            onChange={(v) => setSetting("examMode", v)}
            options={[
              { value: "free", label: "普通做题" },
              { value: "exam", label: "全真模拟" },
            ]}
          />
        </Row>
        <Row title="专项训练的模式" desc="练习模式选完一题马上看对错和解析">
          <Segmented
            label="专项训练的模式"
            value={s.practiceMode}
            onChange={(v) => setSetting("practiceMode", v)}
            options={[
              { value: "exam", label: "考试" },
              { value: "practice", label: "练习" },
            ]}
          />
        </Row>
        <Row title="标出生词" desc="在卷面上标出生词本里的词">
          <Switch label="标出生词" checked={s.showVocabMarks} onChange={(v) => setSetting("showVocabMarks", v)} />
        </Row>
      </Group>

      <Group title="发音">
        <Row title="自动发音" desc="查词和背词时自动读出单词">
          <Switch label="自动发音" checked={s.autoSpeak} onChange={(v) => setSetting("autoSpeak", v)} />
        </Row>
        <Row title="单词口音" desc="词书里的词播真人录音">
          <Segmented
            label="单词口音"
            value={s.accent}
            onChange={(v) => setSetting("accent", v)}
            options={[
              { value: "us", label: "美音" },
              { value: "uk", label: "英音" },
            ]}
          />
          <Button size="icon" variant="ghost" onClick={() => speak("pronunciation")} aria-label="试听单词">
            <SpeakerHigh className="size-[18px]" />
          </Button>
        </Row>
        <Row title="句子和其他词" desc={speechSupported() ? "没有真人录音的词和句子用浏览器自带的语音，不同系统可选的声音不同" : "当前浏览器不支持语音合成"}>
          <select
            value={s.voiceURI ?? ""}
            onChange={(e) => setSetting("voiceURI", e.target.value || null)}
            className="h-10 rounded-[9px] bg-white px-3 text-[14px] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)] max-w-52"
          >
            <option value="">自动选择</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
          <Button size="icon" variant="ghost" onClick={() => speak("Practice makes perfect.")} aria-label="试听">
            <SpeakerHigh className="size-[18px]" />
          </Button>
        </Row>
      </Group>

      <Group title="备考目标">
        <Row title="目标考试" desc="显示在首页和真题训练">
          <input
            value={s.examName}
            onChange={(e) => setSetting("examName", e.target.value)}
            placeholder="如：考研英语一"
            className="h-10 rounded-[9px] bg-white px-3 text-[14px] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)] w-40"
          />
        </Row>
        <Row title="考试日期" desc="设置后显示倒计时">
          <input
            type="date"
            value={s.examDate ?? ""}
            onChange={(e) => setSetting("examDate", e.target.value || null)}
            className="h-10 rounded-[9px] bg-white px-3 text-[14px] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)]"
          />
        </Row>
      </Group>

      <Group title="AI 助教的长期记忆" id="memory">
        <AgentMemory />
      </Group>

      <Group title="数据">
        <div className="px-5 py-4 text-[13px] leading-[21px] text-[var(--ink-700)]">
          现在是单机版：所有数据只存在这台设备的浏览器里。换设备、换浏览器或清理浏览器数据之前，请先导出备份。
        </div>
        <Row title="导出备份" desc="生词本、背词进度、做题记录、设置">
          <Button onClick={doExport}>
            <DownloadSimple className="size-[18px]" /> 导出
          </Button>
        </Row>
        <Row title="导入备份" desc="会覆盖当前数据">
          <Button onClick={() => fileRef.current?.click()}>
            <UploadSimple className="size-[18px]" /> 导入
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doImport(f);
              e.target.value = "";
            }}
          />
        </Row>
        <Row title="清空所有数据">
          <Button variant="danger" onClick={doClear}>
            <Trash className="size-[18px]" /> 清空
          </Button>
        </Row>
        {msg && <div className="px-5 py-3 text-[14px] text-[var(--blue)]">{msg}</div>}
      </Group>

      <Group title="关于">
        <div className="space-y-1.5 px-5 py-4 text-[13px] text-[var(--ink-700)]">
          <p>英语之道 v0.1.0（单机版）</p>
          <p>
            词典数据来自{" "}
            <a className="text-primary hover:underline" href="https://github.com/skywind3000/ECDICT" target="_blank" rel="noreferrer">
              ECDICT
            </a>
            （MIT 协议）；记忆算法使用 FSRS。
          </p>
          <p>标"示例"的试卷是按真题题型原创的模拟题，只用于演示功能。</p>
        </div>
      </Group>
    </div>
  );
}

/** AI 助教记住的要点：每次问完由模型整理，这里能改、能删 */
function AgentMemory() {
  const rows = useLiveQuery(() => db.memory.orderBy("updatedAt").reverse().toArray(), []);
  if (!rows) return null;
  if (!rows.length) return <div className="px-5 py-4 text-[13px] leading-[21px] text-[var(--ink-500)]">还没有记忆。做题时点词或长按句子再点"问 AI"，聊完 AI 会把你卡住的语法点、喜欢的讲法记在这台设备上，下次讲解时用上。</div>;
  return (
    <>
      {rows.map((m) => (
        <div key={m.id} className="flex items-center gap-3 px-5 py-2.5">
          <span className="tag-paper flex-none">{MEMORY_KINDS[m.kind] ?? "记忆"}</span>
          <input
            defaultValue={m.text}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (!v) void db.memory.delete(m.id!);
              else if (v !== m.text) void db.memory.update(m.id!, { text: v, updatedAt: Date.now() });
            }}
            className="min-w-0 flex-1 rounded-[6px] bg-transparent px-1.5 py-1 text-[14px] outline-none focus:bg-[var(--paper-100)]"
            aria-label="记忆内容"
          />
          <button type="button" onClick={() => void db.memory.delete(m.id!)} className="grid size-8 flex-none place-items-center rounded-[8px] text-[var(--ink-500)] hover:bg-[var(--fill-quiet)] hover:text-[var(--red)]" aria-label="删掉这条">
            <Trash className="size-4" />
          </button>
        </div>
      ))}
      <Row title={`共 ${rows.length} 条`} desc="点文字可以直接改；清空后 AI 会重新认识你">
        <Button variant="danger" size="sm" onClick={() => confirm("清空 AI 助教的全部记忆？") && void db.memory.clear()}>
          清空记忆
        </Button>
      </Row>
    </>
  );
}
