import { useEffect, useRef, useState } from "react";
import { SpeakerHigh } from "@phosphor-icons/react";
import type { Grade } from "ts-fsrs";
import { phonetic, shortTranslation, type DictEntry } from "@/lib/dict";
import { spellGrade } from "@/lib/learning";
import { speak } from "@/lib/speech";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui";

const norm = (s: string) => s.trim().toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ");

/** 逐字母对照：对的墨色，错的红色，少写的位置画一道红色短线 */
function Letters({ typed, answer }: { typed: string; answer: string }) {
  const n = Math.max(typed.length, answer.length);
  return (
    <div className="serif flex flex-wrap justify-center gap-x-[3px] text-[34px] leading-[44px] tracking-[0.02em]" aria-label={`你拼的是 ${typed}`}>
      {Array.from({ length: n }, (_, i) => {
        const t = typed[i];
        const ok = t !== undefined && t.toLowerCase() === answer[i]?.toLowerCase();
        return t === undefined ? (
          <span key={i} className="inline-block w-[0.5em] translate-y-[-0.18em] self-end border-b-2 border-[var(--red)]" />
        ) : (
          <span key={i} className={ok ? "text-[var(--ink)]" : "text-[var(--red)]"}>
            {t === " " ? " " : t}
          </span>
        );
      })}
    </div>
  );
}

/**
 * 拼写 / 听写：拼写显示中文释义、音标和发音按钮；听写自动播真人发音，只给发音。
 * 回车核对：逐字母标出对错；错 2 次给首字母提示，错 3 次（或点"看答案"）显示全词，算不认识
 */
export function SpellCard({ word, entry, mode, onResult }: { word: string; entry: DictEntry | null | undefined; mode: "spell" | "dictation"; onResult: (g: Grade) => void }) {
  const answer = entry?.w ?? word;
  const [value, setValue] = useState("");
  const [wrong, setWrong] = useState(0);
  const [last, setLast] = useState<string | null>(null); // 上一次拼错的
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  // 换词：清空；听写自动发音
  useEffect(() => {
    setValue("");
    setWrong(0);
    setLast(null);
    done.current = false;
    input.current?.focus();
  }, [word]);
  useEffect(() => {
    if (mode === "dictation" && entry !== undefined) void speak(answer);
  }, [mode, entry, answer]);

  // 平板弹出键盘时，把输入框留在键盘上面
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const keep = () => {
      const el = input.current;
      if (!el || document.activeElement !== el) return;
      const r = el.getBoundingClientRect();
      if (r.bottom > vv.height - 16) el.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    vv.addEventListener("resize", keep);
    return () => vv.removeEventListener("resize", keep);
  }, []);

  const finish = (g: Grade) => {
    if (done.current) return;
    done.current = true;
    onResult(g);
  };

  const check = () => {
    const v = norm(value);
    if (!v || done.current) return;
    if (v === norm(answer)) return finish(spellGrade(wrong, false));
    const n = wrong + 1;
    setWrong(n);
    setLast(value.trim());
    setValue("");
    if (n >= 3) finish(spellGrade(n, true));
  };

  const hint = wrong >= 2 ? `${answer[0]}${answer.slice(1).replace(/[^ \-']/g, "_")}` : null;
  const meaning = entry ? shortTranslation(entry, 3) : "";

  return (
    <div className="card card-raised relative px-6 pt-7 pb-6 text-center">
      {mode === "spell" ? (
        <>
          <p className="mx-auto max-w-[440px] text-[17px] leading-7 text-[var(--ink)]">{entry === undefined ? "…" : meaning || "词典里没有这个词的释义"}</p>
          <button type="button" onClick={() => void speak(answer)} className="mt-2 inline-flex h-10 items-center gap-2 rounded-full px-4 text-[var(--ink-500)] transition hover:bg-[var(--paper-100)] hover:text-[var(--ink)]" aria-label="发音">
            {entry && phonetic(entry) && <span className="font-[family-name:var(--font-mono)] text-[14px]">{phonetic(entry)}</span>}
            <SpeakerHigh className="size-5" />
          </button>
        </>
      ) : (
        <button type="button" onClick={() => void speak(answer)} className="mx-auto flex size-16 items-center justify-center rounded-full bg-[var(--blue-tint)] text-[var(--blue)] transition hover:bg-[var(--blue-line)] active:scale-95" aria-label="再听一遍">
          <SpeakerHigh className="size-7" weight="fill" />
        </button>
      )}

      <div className="mt-5 min-h-[44px]">{last && <Letters typed={last} answer={answer} />}</div>
      {hint && <p className="serif mt-1 text-[20px] tracking-[0.18em] text-[var(--ink-500)]">{hint}</p>}

      <input
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            check();
          }
        }}
        onFocus={(e) => {
          const el = e.currentTarget;
          setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
        }}
        aria-label={mode === "spell" ? "拼出这个词" : "写出听到的词"}
        placeholder={mode === "spell" ? "拼出这个词" : "写出听到的词"}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        className={cn(
          "serif mx-auto mt-4 block h-14 w-full max-w-[360px] rounded-[12px] bg-[var(--paper-50)] px-4 text-center text-[26px] text-[var(--ink)] shadow-[inset_0_0_0_1px_var(--line-control)] outline-none transition-shadow",
          "placeholder:font-sans placeholder:text-[15px] placeholder:text-[var(--ink-300)] focus:bg-white focus:shadow-[inset_0_0_0_2px_var(--blue)]",
        )}
      />
      <div className="mt-4 flex items-center justify-center gap-2">
        <Button variant="ghost" onClick={() => finish(spellGrade(wrong, true))}>
          看答案
        </Button>
        <Button variant="primary" onClick={check} disabled={!value.trim()}>
          核对
        </Button>
      </div>
    </div>
  );
}
