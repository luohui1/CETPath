import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { LogoMark } from "@/components/Logo";
import { PaperThumb } from "@/components/paper-ui";
import { signIn } from "@/lib/auth";
import { cn } from "@/lib/utils";

const COVER = "cet6-2026-06-1";

export function WelcomePage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reg = mode === "register";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await signIn(name.trim(), pw, reg);
      nav("/", { replace: true });
    } catch (x) {
      setErr(x instanceof Error ? x.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };
  const guest = () => localStorage.setItem("yz-guest", "1");
  const input = "h-12 w-full rounded-[8px] border border-[var(--line)] bg-white px-3 text-[15px] outline-none transition-colors focus:border-[var(--ink-700)]";

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[var(--paper,#f6f4ee)] text-[var(--ink)]">
      {/* 右边一张放大的真卷，带红笔圈注和 Agent 批注，就是用起来的样子 */}
      <div aria-hidden className="pointer-events-none absolute top-24 -right-24 hidden w-[600px] rotate-[-5deg] lg:block xl:right-0">
        <PaperThumb id={COVER} width={600} fan />
        <svg viewBox="0 0 600 300" className="absolute top-[150px] left-0 w-full overflow-visible">
          <path d="M318 62 C 260 40, 196 52, 200 78 C 204 104, 300 108, 352 92 C 392 78, 380 50, 330 44" fill="none" stroke="#d0342c" strokeWidth="3.2" strokeLinecap="round" />
          <path d="M356 90 Q 410 120 430 160" fill="none" stroke="#d0342c" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
        <span className="absolute top-[318px] left-[400px] rotate-[4deg] font-['Kaiti_SC','STKaiti','KaiTi',serif] text-[30px] text-[#d0342c]">开头必须引用！</span>
        <div className="absolute top-[420px] -left-28 w-[260px] rotate-[5deg] rounded-[10px] bg-white p-4 text-[14px] leading-[1.6] shadow-[0_18px_40px_-16px_rgba(15,31,56,0.35),0_0_0_1px_var(--line)]">
          <span className="mb-1 inline-block rounded bg-[var(--blue)] px-1.5 text-[11px] font-semibold text-white">Agent</span>
          <p>写作要求：开头必须引用题目里给的这句话，漏了会扣分。</p>
        </div>
      </div>

      <div className="relative mx-auto max-w-[1180px] px-6 pt-8 pb-16 sm:px-10">
        <div className="flex items-center gap-2">
          <LogoMark className="size-7" />
          <span className="font-serif text-[18px] font-semibold">英语之道</span>
        </div>

        <h1 className="mt-16 font-serif text-[76px] leading-[0.98] font-bold tracking-[-0.02em] sm:text-[112px] lg:mt-24 lg:text-[132px]">
          真题，
          <br />
          <span className="relative inline-block">
            <span aria-hidden className="absolute -inset-x-2 bottom-[0.08em] h-[0.42em] -skew-x-6 bg-[#ffd84d]" />
            <span className="relative">做透。</span>
          </span>
        </h1>
        <p className="mt-8 max-w-[30em] text-[17px] leading-[1.75] text-[var(--ink-700)]">
          四六级、考研真卷原样打开，在卷子上写写画画；做完和 Agent 复盘，它看得到你错在哪、每题用了多久。还有每天更新的外刊。
        </p>

        <div className="mt-12 max-w-[380px]">
          <div className="flex gap-6 text-[15px] font-semibold">
            {(["login", "register"] as const).map((m) => (
              <button key={m} type="button" onClick={() => (setMode(m), setErr(null))} className={cn("pb-1 transition-colors", mode === m ? "border-b-2 border-[var(--ink)]" : "border-b-2 border-transparent text-[var(--ink-500)] hover:text-[var(--ink-700)]")}>
                {m === "login" ? "登录" : "注册"}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="mt-5 space-y-3">
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" required placeholder={reg ? "用户名（2–20 个字）" : "用户名"} className={input} />
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={reg ? "new-password" : "current-password"} required minLength={6} placeholder={reg ? "密码（至少 6 位，别用其他网站的）" : "密码"} className={input} />
            {err && <p className="text-[13px] text-[#d0342c]">{err}</p>}
            <button type="submit" disabled={busy} className="h-12 w-full rounded-[8px] bg-[var(--ink)] text-[15px] font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-50">
              {busy ? "请稍候…" : reg ? "注册，开始做题" : "登录"}
            </button>
          </form>
          <p className="mt-3 text-[12.5px] text-[var(--ink-500)]">{reg ? "这台设备上已有的数据会合并进新账号。" : "登录后生词、错题、笔记在各台设备上同步。"}</p>
          <Link to="/" replace onClick={guest} className="mt-8 inline-block text-[14px] font-medium underline decoration-[var(--line)] underline-offset-4 hover:decoration-[var(--ink)]">
            不登录，先用着 →
          </Link>
        </div>

        <div className="relative mt-14 lg:hidden">
          <PaperThumb id={COVER} width={300} fan className="rotate-[-4deg]" />
        </div>
      </div>
    </div>
  );
}
