import { memo, useEffect, useMemo, useRef, type Ref } from "react";
import { letter, userText, type GradedPerQ } from "../grade";
import type {
  IeltsAnswerValue,
  IeltsFillGroup,
  IeltsMatchGroup,
  IeltsMultiGroup,
  IeltsPaperGroup,
  IeltsSingleGroup,
} from "../types";

/**
 * Memoized raw HTML wrapper: stabilizes `{ __html }` object reference so React NEVER resets
 * `element.innerHTML` across parent re-renders (preserving native browser text selections & `<mark>` highlights!).
 */
export const RawHtml = memo(function RawHtml({
  tag = "span",
  className,
  html,
  innerRef,
}: {
  tag?: "div" | "span";
  className?: string;
  html: string;
  innerRef?: Ref<HTMLDivElement>;
}) {
  const markup = useMemo(() => ({ __html: html }), [html]);
  if (tag === "div") {
    return <div ref={innerRef} className={className} dangerouslySetInnerHTML={markup} />;
  }
  return <span className={className} dangerouslySetInnerHTML={markup} />;
});

export interface GroupViewCtx {
  curQ: number;
  getAnswer: (n: number) => IeltsAnswerValue | undefined;
  setAnswer: (n: number, v: IeltsAnswerValue | undefined) => void;
  focusQ: (n: number) => void;
  pickedMatchOpt: { groupFirst: number; optIdx: number } | null;
  setPickedMatchOpt: (v: { groupFirst: number; optIdx: number } | null) => void;
  onZoomImg: (src: string) => void;
  review: {
    perQ: Record<number, GradedPerQ>;
    explain: Record<string, string>;
    source: Record<string, string[]>;
    onLocateSource?: (quotes: string[]) => void;
  } | null;
}

function ImageBox({ src, alt, onZoom }: { src: string; alt: string; onZoom: (s: string) => void }) {
  return (
    <div className="cbt-qimg">
      <img src={src} alt={alt} referrerPolicy="no-referrer" onClick={() => onZoom(src)} />
      <div className="cbt-zoom-hint">点击图片可放大查看细节</div>
    </div>
  );
}

// ---------- Fill-in-the-blank (DOM hydrated so complex HTML tables/notes stay intact) ----------
function FillBody({ g, ctx }: { g: IeltsFillGroup; ctx: GroupViewCtx }) {
  const ref = useRef<HTMLDivElement>(null);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  // Build HTML + inputs once per group identity / review switch
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.innerHTML = g.body;
    box.querySelectorAll("span.blank").forEach((sp) => {
      const el = sp as HTMLElement;
      const n = Number(el.dataset.q);
      const i = Number(el.dataset.i);
      const k = g.blanks[String(n)] ?? 1;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "cbt-fillin";
      input.autocomplete = "off";
      input.autocapitalize = "off";
      input.spellcheck = false;
      input.setAttribute("autocorrect", "off");
      input.setAttribute("data-gramm", "false");
      input.setAttribute("aria-label", `Question ${n}`);
      input.placeholder = String(n);
      input.dataset.q = String(n);
      input.dataset.i = String(i);
      input.addEventListener("focus", () => ctxRef.current.focusQ(n));
      input.addEventListener("input", () => {
        if (k === 1) {
          ctxRef.current.setAnswer(n, input.value);
        } else {
          const vals = Array.from(box.querySelectorAll<HTMLInputElement>(`input[data-q="${n}"]`)).map((x) => x.value);
          ctxRef.current.setAnswer(n, vals);
        }
      });
      sp.replaceWith(input);
    });
  }, [g.body, g.blanks, g.first]);

  // Sync values, active border, and review state without replacing focused input
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.querySelectorAll<HTMLInputElement>("input.cbt-fillin").forEach((inp) => {
      const n = Number(inp.dataset.q);
      const i = Number(inp.dataset.i);
      const k = g.blanks[String(n)] ?? 1;
      const cur = ctx.getAnswer(n);
      const want = k > 1 ? (Array.isArray(cur) ? String(cur[i] ?? "") : "") : String(cur ?? "");
      if (document.activeElement !== inp && inp.value !== want) {
        inp.value = want;
      }
      inp.disabled = Boolean(ctx.review);
      inp.classList.toggle("cur", ctx.curQ === n);
      inp.classList.remove("ok", "bad");
      if (ctx.review) {
        const rq = ctx.review.perQ[n];
        if (rq) inp.classList.add(rq.ok ? "ok" : "bad");
      }
    });
  });

  return <div ref={ref} className="cbt-qbody" />;
}

// ---------- Single Choice & TFNG / YNNG ----------
function SingleBody({ g, ctx }: { g: IeltsSingleGroup; ctx: GroupViewCtx }) {
  return (
    <div className="cbt-qbody">
      {g.items.map((it) => {
        const n = it.n;
        const cur = ctx.getAnswer(n);
        const rq = ctx.review?.perQ[n];
        const statusCls = ctx.review && rq ? (rq.ok ? " ok" : " bad") : "";
        return (
          <div key={n} className={`cbt-qitem${ctx.curQ === n ? " cur-item" : ""}`} data-q={n}>
            <div
              className="cbt-qline"
              onClick={() => {
                if (!window.getSelection()?.isCollapsed) return;
                ctx.focusQ(n);
              }}
            >
              <span className={`cbt-qnum${ctx.curQ === n ? " active" : ""}${statusCls}`} data-q={n}>
                {n}
              </span>
              <RawHtml className="cbt-qtext" html={it.text} />
            </div>
            {it.options.map((optHtml, i) => {
              const selected = cur === i;
              const isRight = ctx.review && rq ? (g.type === "tfng" ? it.options[i] === rq.correct : letter(i) === rq.correct) : false;
              const optCls = [
                "cbt-opt",
                selected ? "sel" : "",
                ctx.review ? (isRight ? "right" : selected ? "wrong" : "") : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <label
                  key={i}
                  className={optCls}
                  onClick={(e) => {
                    // Never collapse a text selection or toggle radio when user dragged to select option text or clicked a mark!
                    if (
                      !window.getSelection()?.isCollapsed ||
                      (e.target as HTMLElement | null)?.closest("mark.cbt-hl, mark.cbt-note")
                    ) {
                      e.preventDefault();
                      return;
                    }
                    if (ctx.review) return;
                    // Allow clicking an already-selected radio option to clear it
                    if (selected) {
                      e.preventDefault();
                      ctx.focusQ(n);
                      ctx.setAnswer(n, undefined);
                    }
                  }}
                >
                  <input
                    type="radio"
                    name={`q_${g.first}_${n}`}
                    checked={selected}
                    disabled={Boolean(ctx.review)}
                    onChange={() => {
                      ctx.focusQ(n);
                      ctx.setAnswer(n, i);
                    }}
                  />
                  {g.type === "single" && <b className="ltr">{letter(i)}</b>}
                  <RawHtml html={optHtml} />
                </label>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Multi-Select (Choose TWO / THREE letters) ----------
function MultiBody({ g, ctx }: { g: IeltsMultiGroup; ctx: GroupViewCtx }) {
  return (
    <div className="cbt-qbody">
      {g.items.map((it) => {
        const raw = ctx.getAnswer(it.n);
        const sel = new Set<number>(Array.isArray(raw) ? raw.map(Number) : []);
        const label = it.count > 1 ? `${it.n}–${it.n + it.count - 1}` : String(it.n);
        const isCur = ctx.curQ >= it.n && ctx.curQ < it.n + it.count;
        const rq = ctx.review?.perQ[it.n];
        const rightLetters = new Set((rq?.correct ?? "").split(/,\s*/).filter(Boolean));
        const qnumCls = [
          "cbt-qnum wide",
          isCur ? "active" : "",
          ctx.review && rq ? (rq.ok ? "ok" : rq.partial ? "part" : "bad") : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div key={it.n} className={`cbt-qitem${isCur ? " cur-item" : ""}`} data-q={it.n}>
            <div
              className="cbt-qline"
              onClick={() => {
                if (!window.getSelection()?.isCollapsed) return;
                ctx.focusQ(it.n);
              }}
            >
              <span className={qnumCls} data-q={it.n}>
                {label}
              </span>
              <RawHtml className="cbt-qtext" html={it.text} />
            </div>
            {it.options.map((optHtml, i) => {
              const checked = sel.has(i);
              const ltr = letter(i);
              const isRight = ctx.review ? rightLetters.has(ltr) : false;
              const optCls = [
                "cbt-opt",
                checked ? "sel" : "",
                ctx.review ? (isRight ? "right" : checked ? "wrong" : "") : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <label
                  key={i}
                  className={optCls}
                  onClick={(e) => {
                    if (
                      !window.getSelection()?.isCollapsed ||
                      (e.target as HTMLElement | null)?.closest("mark.cbt-hl, mark.cbt-note")
                    ) {
                      e.preventDefault();
                    }
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={Boolean(ctx.review)}
                    onChange={(e) => {
                      const next = new Set(sel);
                      if (e.target.checked) {
                        if (next.size >= it.count) return;
                        next.add(i);
                      } else {
                        next.delete(i);
                      }
                      const arr = [...next].sort((a, b) => a - b);
                      ctx.focusQ(it.n + Math.max(0, Math.min(arr.length, it.count) - 1));
                      ctx.setAnswer(it.n, arr.length ? arr : undefined);
                    }}
                  />
                  <b className="ltr">{ltr}</b>
                  <RawHtml html={optHtml} />
                </label>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Match Mode A: Authentic Inspera 2D Radio Matrix Table ----------
function MatchTableBody({ g, ctx }: { g: IeltsMatchGroup; ctx: GroupViewCtx }) {
  const rows = g.rows ?? Array.from({ length: g.last - g.first + 1 }, (_, i) => ({ n: g.first + i, text: `Question ${g.first + i}` }));
  const hasOptionDescriptions = g.options.some((o) => o.t.replace(/<[^>]+>/g, "").trim().length > 0);
  return (
    <div className="cbt-qbody">
      {hasOptionDescriptions && (
        <div className="ins-bank">
          {g.optionsTitle && <div className="ins-bank-title">{g.optionsTitle}</div>}
          <div className="ins-pills">
            {g.options.map((o, idx) => (
              <div key={idx} style={{ display: "flex", gap: 8, padding: "2px 0" }}>
                <b className="ins-pill-key">{o.k}</b>
                <RawHtml html={o.t} />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="ins-matrix-wrap">
        <table className="ins-matrix">
          <thead data-hl-skip="1">
            <tr>
              <th>Question</th>
              {g.options.map((o, idx) => (
                <th key={idx}>{o.k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const n = row.n;
              const cur = ctx.getAnswer(n);
              const rq = ctx.review?.perQ[n];
              const qCls = ctx.review && rq ? (rq.ok ? "ok" : "bad") : "";
              return (
                <tr key={n} className={ctx.curQ === n ? "cur-row" : ""} data-q={n}>
                  <td
                    onClick={() => {
                      if (!window.getSelection()?.isCollapsed) return;
                      ctx.focusQ(n);
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <span className={`cbt-qnum ${ctx.curQ === n ? "active " : ""}${qCls}`} data-hl-skip="1">{n}</span>
                      <RawHtml html={row.text} />
                    </div>
                  </td>
                  {g.options.map((o, idx) => {
                    const selected = cur === idx;
                    const isRight = ctx.review && rq ? o.k === rq.correct : false;
                    const cellCls = [
                      "cell-radio",
                      selected ? "sel" : "",
                      ctx.review ? (isRight ? "right" : selected ? "wrong" : "") : "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <td
                        key={idx}
                        className={cellCls}
                        onClick={() => {
                          if (ctx.review) return;
                          ctx.focusQ(n);
                          ctx.setAnswer(n, selected ? undefined : idx);
                        }}
                      >
                        <input
                          type="radio"
                          name={`mat_${g.first}_${n}`}
                          checked={selected}
                          disabled={Boolean(ctx.review)}
                          onChange={() => {}}
                          aria-label={`Question ${n} option ${o.k}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Match Mode B & C: Draggable Pills + Headings-in-Passage / Inline Drop Slots ----------
function MatchDragBody({ g, ctx }: { g: IeltsMatchGroup; ctx: GroupViewCtx }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  // Which option indices are already used in this group?
  const usedByOpt = new Map<number, number>();
  for (let n = g.first; n <= g.last; n++) {
    const v = ctx.getAnswer(n);
    if (typeof v === "number") usedByOpt.set(v, n);
  }

  const assignOption = (targetQ: number, optIdx: number | undefined) => {
    if (ctxRef.current.review) return;
    if (optIdx !== undefined && !g.reuse) {
      // If single-use option was already placed in another slot in this group, clear that old slot
      for (let q = g.first; q <= g.last; q++) {
        if (q !== targetQ && ctxRef.current.getAnswer(q) === optIdx) {
          ctxRef.current.setAnswer(q, undefined);
        }
      }
    }
    ctxRef.current.focusQ(targetQ);
    ctxRef.current.setAnswer(targetQ, optIdx);
    ctxRef.current.setPickedMatchOpt(null);
  };

  // Hydrate inline slots for non-headings drag questions
  useEffect(() => {
    if (g.view === "headings") return;
    const box = bodyRef.current;
    if (!box) return;
    box.innerHTML = g.body;
    box.querySelectorAll("span.blank").forEach((sp) => {
      const n = Number((sp as HTMLElement).dataset.q);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ins-drop-slot";
      btn.dataset.q = String(n);
      btn.setAttribute("aria-label", `Question ${n} drop slot`);
      btn.addEventListener("click", () => {
        if (ctxRef.current.review) return;
        const picked = ctxRef.current.pickedMatchOpt;
        if (picked && picked.groupFirst === g.first) {
          assignOption(n, picked.optIdx);
        } else if (ctxRef.current.getAnswer(n) != null) {
          // Clicking a filled slot clears it back to pool
          assignOption(n, undefined);
        } else {
          ctxRef.current.focusQ(n);
        }
      });
      btn.addEventListener("dragover", (e) => {
        if (ctxRef.current.review) return;
        e.preventDefault();
        btn.classList.add("drag-over");
      });
      btn.addEventListener("dragleave", () => btn.classList.remove("drag-over"));
      btn.addEventListener("drop", (e) => {
        btn.classList.remove("drag-over");
        if (ctxRef.current.review) return;
        e.preventDefault();
        const raw = e.dataTransfer?.getData("application/x-ielts-opt") || e.dataTransfer?.getData("text/plain") || "";
        const [gf, oi] = raw.split(":").map(Number);
        if (gf === g.first && !Number.isNaN(oi)) {
          assignOption(n, oi);
        }
      });
      sp.replaceWith(btn);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.body, g.first, g.view]);

  // Repaint inline slots on answer/focus/pick changes
  useEffect(() => {
    if (g.view === "headings") return;
    const box = bodyRef.current;
    if (!box) return;
    const readyPick = ctx.pickedMatchOpt?.groupFirst === g.first;
    box.querySelectorAll<HTMLButtonElement>("button.ins-drop-slot").forEach((btn) => {
      const n = Number(btn.dataset.q);
      const v = ctx.getAnswer(n);
      const opt = typeof v === "number" ? g.options[v] : undefined;
      const plainOpt = opt ? opt.t.replace(/<[^>]+>/g, "").trim() : "";
      btn.textContent = opt ? (plainOpt ? `${opt.k}. ${plainOpt}` : opt.k) : String(n);
      btn.disabled = Boolean(ctx.review);
      btn.classList.toggle("filled", opt != null);
      btn.classList.toggle("cur", ctx.curQ === n);
      btn.classList.toggle("ready-pick", Boolean(readyPick && !ctx.review));
      btn.classList.remove("ok", "bad");
      if (ctx.review) {
        const rq = ctx.review.perQ[n];
        if (rq) btn.classList.add(rq.ok ? "ok" : "bad");
      }
    });
  });

  const compactPills = g.options.every((o) => o.t.replace(/<[^>]+>/g, "").trim().length <= 18);

  return (
    <div className="cbt-qbody">
      {g.view === "headings" && !ctx.review && (
        <p data-hl-skip="1" style={{ fontSize: "0.9em", color: "var(--muted)", margin: "0 0 10px" }}>
          将下方标题拖入左侧正文对应段落上方的虚线框，或先点选一个标题再点击左侧段落框（点已填入的段落框可清除）。
        </p>
      )}
      {g.view !== "headings" && !ctx.review && (
        <p data-hl-skip="1" style={{ fontSize: "0.9em", color: "var(--muted)", margin: "0 0 10px" }}>
          将选项拖入下方题号虚线框，或先点选选项再点击题号框（再次点击已填题号框可清除）。
        </p>
      )}
      <div className="ins-bank" data-hl-skip="1">
        {g.optionsTitle && <div className="ins-bank-title">{g.optionsTitle}</div>}
        <div className={`ins-pills${compactPills ? " compact" : ""}`}>
          {g.options.map((o, idx) => {
            const isPicked = ctx.pickedMatchOpt?.groupFirst === g.first && ctx.pickedMatchOpt.optIdx === idx;
            const isUsed = !g.reuse && usedByOpt.has(idx);
            return (
              <button
                key={idx}
                type="button"
                draggable={!ctx.review}
                disabled={Boolean(ctx.review)}
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-ielts-opt", `${g.first}:${idx}`);
                  e.dataTransfer.setData("text/plain", `${g.first}:${idx}`);
                }}
                onClick={() => {
                  if (ctx.review) return;
                  ctx.setPickedMatchOpt(isPicked ? null : { groupFirst: g.first, optIdx: idx });
                }}
                className={`ins-pill${isPicked ? " picked" : ""}${isUsed ? " used" : ""}`}
              >
                <b className="ins-pill-key">{o.k}</b>
                {o.t ? <RawHtml html={o.t} /> : null}
              </button>
            );
          })}
        </div>
      </div>

      {g.view === "headings" ? (
        <div data-hl-skip="1" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(g.rows ?? []).map((r) => {
            const v = ctx.getAnswer(r.n);
            const opt = typeof v === "number" ? g.options[v] : undefined;
            const plainOpt = opt ? opt.t.replace(/<[^>]+>/g, "").trim() : "";
            const rq = ctx.review?.perQ[r.n];
            const statusCls = ctx.review && rq ? (rq.ok ? " ok" : " bad") : "";
            return (
              <div
                key={r.n}
                data-q={r.n}
                onClick={() => {
                  if (ctx.review) {
                    ctx.focusQ(r.n);
                    return;
                  }
                  if (ctx.pickedMatchOpt?.groupFirst === g.first) {
                    assignOption(r.n, ctx.pickedMatchOpt.optIdx);
                  } else {
                    ctx.focusQ(r.n);
                  }
                }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 6px", cursor: "pointer" }}
              >
                <span className={`cbt-qnum${ctx.curQ === r.n ? " active" : ""}${statusCls}`}>{r.n}</span>
                <span style={{ minWidth: 96, fontWeight: 700 }}>{r.text}</span>
                <span className={`ins-drop-slot${opt ? " filled" : ""}${ctx.pickedMatchOpt?.groupFirst === g.first ? " ready-pick" : ""}${statusCls}`}>
                  {opt ? `${opt.k}. ${plainOpt}` : "未选（可在正文段首或此处填入）"}
                </span>
                {!ctx.review && opt && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      assignOption(r.n, undefined);
                    }}
                    style={{ border: 0, background: "transparent", textDecoration: "underline", fontSize: 13 }}
                  >
                    Clear
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div ref={bodyRef} />
      )}
    </div>
  );
}

// ---------- Review Feedback Footer ----------
function GroupReviewFeedback({ g, ctx }: { g: IeltsPaperGroup; ctx: GroupViewCtx }) {
  if (!ctx.review) return null;
  const rows: { n: number; label: string; count: number }[] = [];
  if (g.type === "multi") {
    for (const it of g.items) {
      rows.push({ n: it.n, label: it.count > 1 ? `${it.n}–${it.n + it.count - 1}` : String(it.n), count: it.count });
    }
  } else {
    for (let n = g.first; n <= g.last; n++) {
      rows.push({ n, label: String(n), count: 1 });
    }
  }

  return (
    <div className="cbt-fblist">
      {rows.map((r) => {
        const q = ctx.review!.perQ[r.n];
        if (!q) return null;
        const ok = q.ok;
        const partial = q.partial;
        const mine = userText(g, r.n, ctx.getAnswer(r.n));
        const ex = ctx.review!.explain[String(r.n)];
        const srcQuotes = ctx.review!.source[String(r.n)];
        return (
          <div key={r.n} className="cbt-fb">
            <div className="cbt-fbhead">
              <b style={{ minWidth: 38 }}>{r.label}</b>
              <b style={{ color: ok ? "var(--ok)" : partial ? "var(--part)" : "var(--bad)" }}>
                {ok ? "✓ 正确" : partial ? `△ 部分正确 (${q.earned}/${q.max})` : "✗ 错误"}
              </b>
              <span>
                你的答案：<b>{mine || "（未作答）"}</b>
              </span>
              {!ok && (
                <span>
                  正确答案：<b style={{ color: "var(--ok)" }}>{q.correct}</b>
                </span>
              )}
              {ctx.review!.onLocateSource && srcQuotes?.length ? (
                <button
                  type="button"
                  onClick={() => ctx.review!.onLocateSource!(srcQuotes)}
                  style={{ border: 0, background: "none", color: "var(--cur)", textDecoration: "underline", padding: 0, fontSize: 14 }}
                >
                  定位原文
                </button>
              ) : null}
            </div>
            {ex && (
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: "pointer", color: "var(--cur)", fontWeight: 700, fontSize: 14 }}>解析</summary>
                <div className="cbt-extext">{ex}</div>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function QuestionGroupView({ g, ctx }: { g: IeltsPaperGroup; ctx: GroupViewCtx }) {
  return (
    <section className="cbt-qgroup" data-first={g.first} data-last={g.last}>
      <RawHtml tag="div" className="cbt-instr" html={g.instr} />
      {g.questionsImg && <ImageBox src={g.questionsImg} alt={`Questions ${g.first}-${g.last} diagram`} onZoom={ctx.onZoomImg} />}
      {g.optionsImg && <ImageBox src={g.optionsImg} alt={`Questions ${g.first}-${g.last} map/plan`} onZoom={ctx.onZoomImg} />}
      {g.type === "fill" && <FillBody g={g} ctx={ctx} />}
      {(g.type === "single" || g.type === "tfng") && <SingleBody g={g} ctx={ctx} />}
      {g.type === "multi" && <MultiBody g={g} ctx={ctx} />}
      {g.type === "match" && g.view === "table" && <MatchTableBody g={g} ctx={ctx} />}
      {g.type === "match" && g.view !== "table" && <MatchDragBody g={g} ctx={ctx} />}
      <GroupReviewFeedback g={g} ctx={ctx} />
    </section>
  );
}
