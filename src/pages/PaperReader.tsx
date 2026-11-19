import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { bumpDay, db, type AttemptMode } from "@/lib/db";
import { attemptKey, attemptMode, emptyAttempt, retryKey, updateAttempt } from "@/lib/attempts";
import { choiceQuestions, KIND_NAMES, loadPaper, sectionRange, type Paper, type Question } from "@/lib/papers";
import { recordMastery, retryRounds, scoredQuestions } from "@/lib/mistakes";
import { setSetting, useSettings } from "@/lib/settings";
import { ExamRoom } from "@/exam/ExamRoom";
import { Button, EmptyState, LoadingBlock } from "@/components/ui";

/** 只留下这几道题（重做错题）：其余题目、空了的题组和部分都去掉，卷面上就只有这几道的题号 */
function onlyQuestions(paper: Paper, ids: Set<string>): Paper {
  return {
    ...paper,
    sections: paper.sections
      .map((s) => ({ ...s, groups: s.groups.map((g) => ({ ...g, questions: g.questions.filter((q) => ids.has(q.id)) })).filter((g) => g.questions.length) }))
      .filter((s) => s.groups.length),
  };
}

const sameSet = (a: string[] = [], b: string[]) => a.length === b.length && b.every((x) => a.includes(x));


/** 加载中；超过 6 秒还没好就说明卡在哪一步（试卷数据 / 浏览器本地数据库），并给一个刷新 */
function PaperLoading({ paperReady, recordReady }: { paperReady: boolean; recordReady: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(t);
  }, []);
  if (!slow) return <LoadingBlock text="正在加载试卷…" />;
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="card max-w-sm p-6">
        <div className="text-[16px] font-semibold">加载得有点慢</div>
        <ul className="mt-3 space-y-1.5 text-[14px] text-muted">
          <li>{paperReady ? "✓ 试卷数据已读到" : "… 正在读试卷数据（网络）"}</li>
          <li>{recordReady ? "✓ 本地记录已读到" : "… 正在读本地记录（浏览器的数据库没响应）"}</li>
        </ul>
        {!recordReady && <p className="mt-3 text-[13px] text-subtle">常见于无痕模式或某些内置浏览器，请在 Chrome / Safari 里打开，或刷新再试。</p>}
        <div className="mt-4 flex gap-2">
          <Button variant="primary" onClick={() => location.reload()}>
            刷新
          </Button>
          <Link to="/papers">
            <Button>返回</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * 做题页：加载试卷、记录作答和用时，界面交给考场（原卷 PDF）。
 * /paper/:id 是整套真题训练（开始前选全真模拟或普通做题）；/paper/:id/:section 是专项训练，只做原卷里的一个部分，单独计分；
 * /paper/:id/retry?q=q3,q7 是重做错题：在原卷上只做这几道，每次覆盖
 */
export function PaperReaderPage() {
  const { id = "", section: param } = useParams();
  const [search] = useSearchParams();
  const settings = useSettings();
  const retry = param === "retry";
  const sectionId = retry ? undefined : param;
  const key = retry ? retryKey(id) : attemptKey(id, sectionId);
  const [paper, setPaper] = useState<Paper | null>(null);
  const [error, setError] = useState<string | null>(null);
  // undefined：还在读；null：没有记录
  const attempt = useLiveQuery(() => db.attempts.get(key).then((a) => a ?? null), [key]);
  const [sessionSec, setSessionSec] = useState(0);
  const [round, setRound] = useState(1);
  const qParam = search.get("q") ?? "";
  const focus = search.get("focus");

  useEffect(() => {
    setPaper(null);
    setError(null);
    setSessionSec(0);
    loadPaper(id).then(
      (p) => {
        const s = sectionId ? p.sections.find((x) => x.id === sectionId) : undefined;
        if (sectionId && !s) return setError("这套卷子里没有这个部分");
        setPaper(p);
        document.title = `${retry ? "重做错题 · " : s ? `${KIND_NAMES[s.kind]} · ` : ""}${p.title} - 英语之道`;
      },
      (e: Error) => setError(e.message),
    );
    return () => {
      document.title = "英语之道";
    };
  }, [id, sectionId, retry]);

  // 重做错题：地址里的题（只认这套卷里的选择题）
  const retryIds = useMemo(() => {
    if (!retry || !paper) return [];
    const ok = new Set(choiceQuestions(paper).map((q) => q.id));
    return [...new Set(qParam.split(",").filter((x) => ok.has(x)))];
  }, [retry, paper, qParam]);

  // 每次进来重做都重新开始（覆盖上一次，历史在错题本里）；只有同一批题、还没交卷的才接着做。
  // 只在进来时判断一次，交卷后留在页面上看交卷单不会被清掉
  const [prep, setPrep] = useState<{ q: string; since: number } | null>(null);
  const prepKey = `${id}|${qParam}`;
  useEffect(() => {
    if (!retry || attempt === undefined || !paper || !retryIds.length || prep?.q === prepKey) return;
    if (attempt && sameSet(attempt.retryIds, retryIds) && !attempt.submittedAt) return setPrep({ q: prepKey, since: 0 });
    const fresh = emptyAttempt(key, { mode: "retry", retryIds });
    setPrep({ q: prepKey, since: fresh.startedAt });
    void db.attempts.put(fresh);
  }, [retry, attempt, paper, retryIds, prepKey, prep, key]);
  const retryStale = retry && (prep?.q !== prepKey || !attempt || attempt.startedAt < prep.since);
  useEffect(() => {
    if (!retry || !attempt?.retryIds) return;
    void retryRounds(id, attempt.retryIds, attempt.startedAt).then((n) => setRound(n + 1));
  }, [retry, id, attempt?.retryIds, attempt?.startedAt]);

  // 专项训练：考场里只有这一个部分，卷面截取它在原卷上的范围；重做错题：只有这几道
  const scope = useMemo(() => {
    const section = paper?.sections.find((s) => s.id === sectionId);
    if (!paper || !section) return null;
    return { section, range: sectionRange(paper, section.id), view: { ...paper, sections: [section] } };
  }, [paper, sectionId]);
  const view = useMemo(() => (retry && paper ? onlyQuestions(paper, new Set(retryIds)) : (scope?.view ?? paper)), [retry, paper, retryIds, scope]);

  // 做题方式：有记录按记录（旧记录当整套模考）；专项新开按地址或设置；整套新开要先选
  const asked = search.get("mode");
  const mode: AttemptMode = retry ? "retry" : attempt ? attemptMode(attempt) : sectionId ? ((asked ?? settings.practiceMode) === "practice" ? "practice" : "exam") : "free";
  const init = useMemo(() => ({ mode }), [mode]);

  const answers = attempt?.answers ?? {};
  const texts = attempt?.texts ?? {};
  const submitted = !!attempt?.submittedAt;

  // 记录做题时长：页面可见且未交卷时每 15 秒累计一次
  useEffect(() => {
    if (!paper || submitted || attempt === undefined) return;
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setSessionSec((s) => s + 15);
      void updateAttempt(key, (a) => (a.spentSec = (a.spentSec ?? 0) + 15), init);
    }, 15_000);
    return () => clearInterval(t);
  }, [paper, submitted, key, attempt === undefined, init]); // eslint-disable-line react-hooks/exhaustive-deps

  // 再点一次同一个选项就是取消；练习模式选了就锁定
  const choose = useCallback(
    (q: Question, k: string) => {
      void updateAttempt(
        key,
        (a) => {
          if (a.answers[q.id] && attemptMode(a) === "practice") return;
          if (a.answers[q.id] === k) delete a.answers[q.id];
          else {
            a.answers[q.id] = k;
            // 选了被划掉的选项，就不再算排除
            if (a.struck?.[q.id]?.includes(k)) a.struck[q.id] = a.struck[q.id].filter((x) => x !== k);
          }
        },
        init,
      );
    },
    [key, init],
  );

  // 标记待检查：再点一次取消
  const flag = useCallback(
    (q: Question) => {
      void updateAttempt(
        key,
        (a) => {
          const set = new Set(a.flags ?? []);
          if (set.has(q.id)) set.delete(q.id);
          else set.add(q.id);
          a.flags = [...set];
        },
        init,
      );
    },
    [key, init],
  );

  // 排除选项：划掉认为错的选项，再点一次恢复
  const strike = useCallback(
    (q: Question, k: string) => {
      void updateAttempt(
        key,
        (a) => {
          const struck = { ...(a.struck ?? {}) };
          const list = new Set(struck[q.id] ?? []);
          if (list.has(k)) list.delete(k);
          else list.add(k);
          struck[q.id] = [...list];
          a.struck = struck;
        },
        init,
      );
    },
    [key, init],
  );

  const onLookedUp = useCallback(() => {
    void bumpDay({ lookups: 1 });
    void updateAttempt(key, (a) => (a.lookups += 1), init);
  }, [key, init]);

  // 单题秒表停下来时记一笔（同一题累加）
  const onQuestionTime = useCallback(
    (qid: string, sec: number) => void updateAttempt(key, (a) => (a.questionSec = { ...a.questionSec, [qid]: (a.questionSec?.[qid] ?? 0) + sec }), init),
    [key, init],
  );
  // 各部分用时：考场每 15 秒交来一批
  const onSectionTime = useCallback(
    (delta: Record<string, number>) =>
      void updateAttempt(
        key,
        (a) => {
          const s = { ...a.sectionSec };
          for (const [k, v] of Object.entries(delta)) s[k] = (s[k] ?? 0) + v;
          a.sectionSec = s;
        },
        init,
      ),
    [key, init],
  );

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <EmptyState
          title="试卷打不开"
          desc={error}
          action={
            <Link to={retry ? "/mistakes" : sectionId ? "/practice" : "/papers"}>
              <Button>{retry ? "返回错题本" : sectionId ? "返回专项训练" : "返回真题训练"}</Button>
            </Link>
          }
        />
      </div>
    );
  }
  if (!paper || !view || attempt === undefined) return <PaperLoading paperReady={!!paper} recordReady={attempt !== undefined} />;
  if (retry && !retryIds.length) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <EmptyState title="没有要重做的题" desc="错题本里选几道题再来重做。" action={<Link to="/mistakes"><Button>返回错题本</Button></Link>} />
      </div>
    );
  }
  if (retryStale) return <LoadingBlock text="正在准备错题…" />;

  // 确认框由考场弹出，这里直接交卷（同时记进错题本）、重做
  const submit = async () => {
    const choices = choiceQuestions(view);
    const score = choices.filter((q) => answers[q.id] === q.answer).length;
    const at = Date.now();
    await updateAttempt(key, (a) => {
      a.submittedAt = at;
      a.masteryAt = at;
      a.score = score;
      a.total = choices.length;
    });
    await bumpDay({ questions: choices.length, correct: score });
    return recordMastery(id, scoredQuestions(view), answers, mode, at);
  };

  const redo = async () => {
    await updateAttempt(key, (a) => {
      a.answers = {};
      a.texts = {};
      a.flags = [];
      a.struck = {};
      a.submittedAt = undefined;
      a.masteryAt = undefined;
      a.score = undefined;
      a.total = undefined;
      a.spentSec = 0;
      a.sectionSec = undefined;
      a.questionSec = undefined;
      a.startedAt = Date.now();
    });
    setSessionSec(0);
  };

  return (
    <ExamRoom
      key={key}
      paper={view}
      scope={scope ?? undefined}
      mode={mode}
      attemptKey={key}
      retryRound={retry ? round : undefined}
      focus={focus}
      attempt={attempt ?? undefined}
      answers={answers}
      texts={texts}
      submitted={submitted}
      elapsed={submitted ? (attempt?.spentSec ?? 0) : Math.max(attempt?.spentSec ?? 0, sessionSec)}
      onChoose={choose}
      onFlag={flag}
      onStrike={strike}
      onSubmit={submit}
      onRedo={redo}
      onLookedUp={onLookedUp}
      onQuestionTime={onQuestionTime}
      onSectionTime={onSectionTime}
      onMock={
        // 整套卷还没动笔时可以改成全真模拟（从头倒计时）
        !sectionId && !retry && (!attempt || (attemptMode(attempt) === "free" && !attempt.submittedAt && !Object.keys(attempt.answers).length))
          ? () => {
              void setSetting("examMode", "exam");
              void db.attempts.put(emptyAttempt(key, { mode: "exam" }));
            }
          : undefined
      }
    />
  );
}
