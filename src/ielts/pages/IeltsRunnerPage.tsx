import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { Button, EmptyState, LoadingBlock } from "@/components/ui";
import { loadIeltsExplain, loadIeltsKey, loadIeltsPaper } from "../data";
import { IeltsExamRoom } from "../exam/IeltsExamRoom";
import { isRunReviewUnlocked, patchSkillState, startOrResumeIeltsRun, submitIeltsSkill } from "../store";
import type {
  IeltsAttemptRow,
  IeltsExplain,
  IeltsKey,
  IeltsPaper,
  IeltsRunMode,
  IeltsRunScope,
  IeltsSkill,
  IeltsSkillState,
} from "../types";

/**
 * Route `/ielts/start/:paperId` — creates or resumes an IELTS run and redirects to `/ielts/exam/:runId`.
 * Query params: `scope=full|listening|reading|writing` (default `full`), `mode=mock|practice` (default `mock`), `new=1`.
 */
export function IeltsStartPage() {
  const { paperId = "" } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const scope = (search.get("scope") as IeltsRunScope) || "full";
    const mode = (search.get("mode") as IeltsRunMode) || "mock";
    const forceNew = search.get("new") === "1";
    startOrResumeIeltsRun({ paperId: decodeURIComponent(paperId), scope, mode, forceNew }).then(
      (run) => navigate(`/ielts/exam/${run.id}`, { replace: true }),
      (e: Error) => setErr(e.message),
    );
  }, [paperId, search, navigate]);

  if (err) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <EmptyState title="无法启动雅思考试" desc={err} action={<Link to="/papers?exam=ielts-a"><Button>返回题库</Button></Link>} />
      </div>
    );
  }
  return <LoadingBlock text="正在准备雅思机考环境…" />;
}

/**
 * Route `/ielts/exam/:runId` (active exam) and `/ielts/review/:runId` (unlocked post-submit review).
 * Strictly enforces anti-pollution lock: if a run is NOT completely submitted, `/ielts/review/:runId`
 * immediately redirects back to `/ielts/exam/:runId` without loading `key` or `explain`.
 */
export function IeltsRunnerPage({ review }: { review: boolean }) {
  const { runId = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const run = useLiveQuery(() => db.ieltsAttempts.get(runId).then((r) => r ?? null), [runId]);
  const [paper, setPaper] = useState<IeltsPaper | null>(null);
  const [keyDoc, setKeyDoc] = useState<IeltsKey | null>(null);
  const [explainDoc, setExplainDoc] = useState<IeltsExplain | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const unlocked = isRunReviewUnlocked(run);

  useEffect(() => {
    if (!run) return;
    setErr(null);
    loadIeltsPaper(run.paperId).then(setPaper, (e: Error) => setErr(e.message));
  }, [run?.paperId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load key + explain ONLY when `review && unlocked`!
  useEffect(() => {
    if (!run || !review || !unlocked) {
      setKeyDoc(null);
      setExplainDoc(null);
      return;
    }
    Promise.all([loadIeltsKey(run.paperId), loadIeltsExplain(run.paperId)]).then(
      ([k, ex]) => {
        setKeyDoc(k);
        setExplainDoc(ex);
      },
      (e: Error) => setErr(e.message),
    );
  }, [run?.paperId, review, unlocked]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeSkill: IeltsSkill = (() => {
    if (!run) return "listening";
    if (review) {
      const asked = search.get("skill") as IeltsSkill | null;
      return asked && run.skills.includes(asked) ? asked : run.skills[0];
    }
    return run.currentSkill;
  })();

  const runIdVal = run?.id;
  const runRef = useRef<IeltsAttemptRow | null | undefined>(run);
  runRef.current = run;

  const onPatch = useCallback(
    (mutator: (st: IeltsSkillState, r: IeltsAttemptRow) => void) => {
      if (!runIdVal || review) return;
      void patchSkillState(runIdVal, activeSkill, mutator, runRef.current ?? undefined);
    },
    [runIdVal, review, activeSkill],
  );

  const onSubmit = useCallback(
    async (reason: "manual" | "timeup") => {
      if (!runIdVal) return;
      const updated = await submitIeltsSkill(runIdVal, activeSkill, reason);
      if (updated?.submittedAt) {
        navigate(`/ielts/review/${updated.id}`, { replace: true });
      }
    },
    [runIdVal, activeSkill, navigate],
  );

  if (run === undefined) return <LoadingBlock text="正在读取考试记录…" />;
  if (run === null) return <Navigate to="/papers?exam=ielts-a" replace />;

  // Anti-pollution route guard
  if (review && !unlocked) return <Navigate to={`/ielts/exam/${run.id}`} replace />;
  if (!review && unlocked) return <Navigate to={`/ielts/review/${run.id}`} replace />;

  if (err) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <EmptyState title="试卷加载出错" desc={err} action={<Link to={`/papers?exam=${run.exam}`}><Button>返回真题库</Button></Link>} />
      </div>
    );
  }

  if (!paper || (review && !explainDoc)) return <LoadingBlock text={review ? "正在加载解析与听力原文…" : "正在加载机考试卷…"} />;

  return (
    <IeltsExamRoom
      key={`${run.id}:${activeSkill}:${review ? "rev" : "exam"}`}
      run={run}
      paper={paper}
      skill={activeSkill}
      review={review}
      keyDoc={keyDoc}
      explainDoc={explainDoc}
      onSwitchReviewSkill={(s) => setSearch({ skill: s }, { replace: true })}
      onPatchSkill={onPatch}
      onSubmitSkill={onSubmit}
      onExit={() => navigate(run.paperId.startsWith("wj:") ? `/practice?exam=${run.exam}&kind=writing` : `/papers?exam=${run.exam}`)}
    />
  );
}
