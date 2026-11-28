import { useRef, useState, type ReactNode, useEffect } from "react";
import { touchMemory } from "@/lib/agent";
import { clearProfile, getProfile, learningStats, PROFILE_SECTIONS, saveProfile, useProfile } from "@/lib/profile";
import { DownloadSimple, SpeakerHigh, Trash, UploadSimple } from "@phosphor-icons/react";
import { clearAll, exportBackup, importBackup } from "@/lib/backup";
import { isIeltsExam } from "@/lib/papers";
import { setSetting, useSettings } from "@/lib/settings";
import { applyTargetExam, resolveTargetExam, TARGET_EXAMS } from "@/lib/targetExam";
import { speak, speechSupported, useEnglishVoices } from "@/lib/speech";
import { cn, downloadText } from "@/lib/utils";
import { StickyTab } from "@/components/paper-ui";
import { AgentModel } from "@/components/AgentModel";
import { IS_PREVIEW } from "@/lib/preview";
import { Link } from "react-router";
import { signOut, useMe } from "@/lib/auth";
import { claimGuestRecords, countUnclaimedGuestRecords, dismissGuestRecords, syncNow, syncState } from "@/lib/sync";
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

function Account() {
  const me = useMe();
  const [st, setSt] = useState(syncState());
  const [guestCount, setGuestCount] = useState(0);
  const [claiming, setClaiming] = useState(false);
  useEffect(() => {
    const on = () => setSt(syncState());
    addEventListener("yz-sync", on);
    return () => removeEventListener("yz-sync", on);
  }, []);
  useEffect(() => {
    if (me) void countUnclaimedGuestRecords().then(setGuestCount);
    else setGuestCount(0);
  }, [me]);
  const label = st.status === "syncing" ? "正在同步…" : st.status === "error" ? `同步出错：${st.error}` : st.at ? `已同步 · ${new Date(st.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "等待同步";
  return (
    <Group title="账号">
      {me ? (
        <>
          <Row title={me.name} desc={`${label}。每个账号使用独立的本地数据库，生词、错题、做题记录、笔记与学习档案在登录同一账号的设备间同步`}>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void syncNow()} loading={st.status === "syncing"}>立即同步</Button>
              <Button size="sm" onClick={() => signOut().catch((e: Error) => alert(e.message))}>退出登录</Button>
            </div>
          </Row>
          {guestCount > 0 && (
            <Row title="发现本机未登录时的学习记录" desc={`访客模式下共有 ${guestCount} 条生词或做题记录，是否合并到当前账号？`}>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  loading={claiming}
                  onClick={async () => {
                    setClaiming(true);
                    try {
                      await claimGuestRecords();
                      setGuestCount(0);
                    } finally {
                      setClaiming(false);
                    }
                  }}
                >
                  合并进此账号
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    dismissGuestRecords();
                    setGuestCount(0);
                  }}
                >
                  暂不合并
                </Button>
              </div>
            </Row>
          )}
        </>
      ) : (
        <Row title="没有登录" desc="当前使用本机访客数据库。登录后各账号独立隔离并在多设备间同步">
          <Link to="/welcome" className="inline-flex h-8 items-center rounded-[10px] bg-[var(--blue)] px-3 text-[13px] font-medium text-white">登录 / 注册</Link>
        </Row>
      )}
    </Group>
  );
}

export function SettingsPage() {
  const s = useSettings();
  const targetExam = resolveTargetExam(s);
  const isIelts = isIeltsExam(targetExam);
  const voices = useEnglishVoices();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  }, []);

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
      {!IS_PREVIEW && <Account />}

      <Group title="备考目标" id="target">
        <Row title="唯一备考目标" desc="切换后，全站真题、专项、听力精练、口语与统计均自动聚焦该考种，并匹配对应词书">
          <div className="flex flex-wrap gap-1.5">
            {TARGET_EXAMS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => void applyTargetExam(t.id)}
                className={cn("pill", targetExam === t.id && "pill-on")}
              >
                {t.short}
              </button>
            ))}
          </div>
        </Row>
        <Row title="考试日期" desc="设置后在首页与侧边栏显示倒计时">
          <input
            type="date"
            value={s.examDate ?? ""}
            onChange={(e) => setSetting("examDate", e.target.value || null)}
            className="h-10 rounded-[9px] bg-white px-3 text-[14px] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)]"
          />
        </Row>
      </Group>

      {isIelts ? (
        <Group title="雅思机考与沉浸度" id="ielts">
          <div className="px-5 py-3.5 text-[13px] leading-[21px] text-[var(--ink-700)]">
            全真模考（整套或单科限时）开考后会自动锁死纯净机考环境，不显示任何查词、生词标记或 AI 入口，且整套连考全部交卷后才解锁复盘。以下开关仅控制单项自由练习与交卷后的复盘页。
          </div>
          <Row title="机考考生显示名" desc="显示在雅思机考界面左上角（留空默认显示 Test Taker）">
            <SettingText value={s.ieltsCandidateName} placeholder="如：Alex Zhang" onSave={(v) => setSetting("ieltsCandidateName", v)} />
          </Row>
          <Row title="复盘允许点词查词" desc="交卷进入复盘后，点击阅读或听力原文单词可查词并带原句收入生词本">
            <Switch label="复盘允许点词查词" checked={s.ieltsReviewLookup} onChange={(v) => setSetting("ieltsReviewLookup", v)} />
          </Row>
          <Row title="复盘标出生词本词汇" desc="交卷进入复盘后，标出你生词本里已有的词">
            <Switch label="复盘标出生词本词汇" checked={s.ieltsReviewVocabMarks} onChange={(v) => setSetting("ieltsReviewVocabMarks", v)} />
          </Row>
          <Row title="复盘显示 AI 助教入口" desc="默认关闭；开启后可在雅思复盘页唤出右侧 AI 助教讲题">
            <Switch label="复盘显示 AI 助教入口" checked={s.ieltsReviewAgent} onChange={(v) => setSetting("ieltsReviewAgent", v)} />
          </Row>
          <Row title="单项练习作答中允许查词" desc="默认关闭，建议做完交卷再查词，避免破坏机考手感">
            <Switch label="单项练习作答中允许查词" checked={s.ieltsPracticeLookup} onChange={(v) => setSetting("ieltsPracticeLookup", v)} />
          </Row>
        </Group>
      ) : (
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
          <Row title="标出生词" desc="在四六级与考研原卷上标出生词本里的词">
            <Switch label="标出生词" checked={s.showVocabMarks} onChange={(v) => setSetting("showVocabMarks", v)} />
          </Row>
        </Group>
      )}

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

      <Group title="Agent 模型" id="agent">
        <AgentModel />
      </Group>

      <Group title="学习者档案（Agent 的长期记忆）" id="memory">
        <AgentMemory />
      </Group>

      <Group title="数据">
        <div className="px-5 py-4 text-[13px] leading-[21px] text-[var(--ink-700)]">
          学习数据默认保存在当前设备的浏览器本地库中；登录账号后会开启云端多设备同步（精听与口语录音音频仅存本机）。换设备或清理浏览器缓存前，建议先导出备份。
        </div>
        <Row title="导出备份" desc="生词本、背词进度、做题记录、精听/口语进度与设置">
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
            （MIT 协议）；词根词缀和词源来自{" "}
            <a className="text-primary hover:underline" href="https://github.com/openetymology/OpenEtymology" target="_blank" rel="noreferrer">
              OpenEtymology
            </a>
            （CC BY-SA 4.0）；记忆算法使用 FSRS。
          </p>
          <p>标"示例"的试卷是按真题题型原创的模拟题，只用于演示功能。</p>
        </div>
      </Group>
    </div>
  );
}

/** Agent 的长期记忆：一份学习者档案，聊完由模型改写，这里能直接改；下面是从本机数据现算的学习情况 */
function AgentMemory() {
  const profile = useProfile();
  const [stats, setStats] = useState("");
  useEffect(() => {
    void getProfile().then(() => learningStats().then(setStats));
  }, []);
  if (profile === undefined) return null;
  return (
    <>
      <div className="space-y-2 px-5 py-4">
        <textarea
          key={profile}
          defaultValue={profile || PROFILE_SECTIONS.map((t) => `## ${t}\n`).join("\n")}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v === profile.trim()) return;
            touchMemory();
            void saveProfile(v);
          }}
          rows={14}
          className="block w-full resize-y rounded-[10px] bg-[var(--paper-100)] px-3 py-2.5 font-mono text-[13px] leading-[1.7] outline-none focus:shadow-[0_0_0_2px_var(--blue)]"
          aria-label="学习者档案"
        />
        <p className="text-[12px] leading-[19px] text-[var(--ink-500)]">每次和 Agent 聊完，它会把值得记住的写进这份档案（合并重复、删掉过时的）；也可以直接在这里改，离开输入框就保存。档案只存在这台设备上。</p>
        {stats && <p className="rounded-[10px] bg-[var(--fill-quiet)] px-3 py-2 text-[12px] leading-[19px] whitespace-pre-line text-[var(--ink-700)]">Agent 还会看到这些学习数据（每次现算，不用记）：{"\n"}{stats}</p>}
      </div>
      <Row title="清空档案" desc="清空后 Agent 会重新认识你">
        <Button variant="danger" size="sm" onClick={() => confirm("清空学习者档案？") && (touchMemory(), void clearProfile())}>
          清空
        </Button>
      </Row>
    </>
  );
}

/** 设置里的文字框：输入时只改本地，设置存进本地库是异步的，直接绑设置值会在中文输入法拼字时把拼音也写进去 */
function SettingText({ value, onSave, placeholder = "请输入" }: { value: string; onSave: (v: string) => void; placeholder?: string }) {
  const [text, setText] = useState(value);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(value);
  }, [value]);
  return (
    <input
      value={text}
      onFocus={() => (editing.current = true)}
      onBlur={() => {
        editing.current = false;
        onSave(text);
      }}
      onChange={(e) => {
        setText(e.target.value);
        if (!(e.nativeEvent as InputEvent).isComposing) onSave(e.target.value);
      }}
      onCompositionEnd={(e) => onSave(e.currentTarget.value)}
      placeholder={placeholder}
      className="h-10 rounded-[9px] bg-white px-3 text-[14px] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)] w-40"
    />
  );
}
