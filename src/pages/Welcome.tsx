import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { LogoMark } from "@/components/Logo";
import { signIn } from "@/lib/auth";
import { WelcomeSections } from "./WelcomeSections";
import { cn } from "@/lib/utils";


/** 示意卷面：自己写的例句，不用任何真题内容 */
function Sheet({ className, style, children }: { className?: string; style?: React.CSSProperties; children?: React.ReactNode }) {
  return (
    <div className={cn("absolute inset-0 rounded-[6px] bg-[#fffdf8] shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_30px_60px_-20px_rgba(15,31,56,0.35),0_0_0_1px_rgba(15,31,56,0.06)]", className)} style={style}>
      {children}
    </div>
  );
}
const bar = (w: string, key?: number) => <span key={key} className="block h-[7px] rounded-full bg-[#e6e2d8]" style={{ width: w }} />;

function MockPaper({ small }: { small?: boolean }) {
  return (
    <div className={cn("[perspective:1600px]", small ? "h-[330px] w-[290px]" : "h-[560px] w-[470px]")}>
      <div className="welcome-float relative size-full [transform-style:preserve-3d] [transform:rotateX(16deg)_rotateY(-22deg)_rotateZ(4deg)]">
        <Sheet className="[transform:translateZ(-60px)_translate(34px,26px)] opacity-70" />
        <Sheet className="[transform:translateZ(-30px)_translate(17px,13px)]" />
        <Sheet className={cn("overflow-hidden", small ? "p-5" : "p-9")}>
          <div className="flex items-baseline justify-between font-serif">
            <span className={cn("font-bold", small ? "text-[13px]" : "text-[18px]")}>Section C · Reading</span>
            <span className="text-[11px] text-[var(--ink-500)]">25 min</span>
          </div>
          <div className="mt-4 space-y-2.5">{["94%", "100%", "88%", "97%"].map(bar)}</div>
          <p className={cn("relative mt-5 font-serif leading-[1.7]", small ? "text-[13px]" : "text-[19px]")}>
            <span className="bg-[#ffe27a]/80 box-decoration-clone px-0.5">Small habits, repeated daily,</span>{" "}
            <span className="relative">
              quietly shape
              <svg viewBox="0 0 120 40" preserveAspectRatio="none" className="absolute -inset-x-2 -inset-y-1.5 h-[calc(100%+12px)] w-[calc(100%+16px)] overflow-visible">
                <path d="M70 4 C 30 0, 2 8, 4 22 C 6 36, 90 40, 114 24 C 126 14, 110 2, 80 5" fill="none" stroke="#d0342c" strokeWidth="2.4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </svg>
            </span>{" "}
            who we become.
          </p>
          <span className={cn("block rotate-[-3deg] text-right font-['Kaiti_SC','STKaiti','KaiTi',serif] text-[#d0342c]", small ? "text-[17px]" : "text-[26px]")}>悄悄塑造 ↑</span>
          <div className="mt-3 space-y-2.5">{["100%", "91%", "96%", "62%"].map(bar)}</div>
          <div className={cn("mt-6 space-y-2", small && "hidden")}>
            {["A", "B", "C", "D"].map((l, i) => (
              <div key={l} className="flex items-center gap-3">
                <span className={cn("grid size-6 place-items-center rounded-full text-[12px] font-semibold", i === 2 ? "bg-[var(--blue)] text-white" : "shadow-[inset_0_0_0_1.5px_#d9d4c8] text-[var(--ink-500)]")}>{l}</span>
                {bar(["70%", "58%", "76%", "64%"][i])}
              </div>
            ))}
          </div>
        </Sheet>
        <div className={cn("absolute rounded-[12px] bg-white/95 shadow-[0_24px_50px_-18px_rgba(15,31,56,0.45),0_0_0_1px_rgba(15,31,56,0.06)] backdrop-blur [transform:translateZ(80px)]", small ? "-bottom-6 -left-4 w-[200px] p-3 text-[12px]" : "-bottom-10 -left-24 w-[270px] p-4 text-[14px]")}>
          <span className="inline-block rounded bg-[var(--blue)] px-1.5 text-[11px] font-semibold text-white">Agent</span>
          <p className="mt-1.5 leading-[1.6]">主干是 habits shape who we become，repeated daily 是插进来的修饰。</p>
        </div>
      </div>
    </div>
  );
}

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
  const input = "h-[54px] w-full rounded-[10px] border border-[var(--line)] bg-white px-4 text-[16px] outline-none transition-colors focus:border-[var(--ink-700)]";

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[var(--paper,#f6f4ee)] text-[var(--ink)]">
      <div aria-hidden className="pointer-events-none absolute top-28 right-[max(24px,calc(50%-560px))] hidden lg:block">
        <MockPaper />
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

        <div className="mt-12 max-w-[460px]">
          <div className="flex gap-7 font-serif text-[22px] font-semibold">
            {(["login", "register"] as const).map((m) => (
              <button key={m} type="button" onClick={() => (setMode(m), setErr(null))} className={cn("pb-1 transition-colors", mode === m ? "border-b-2 border-[var(--ink)]" : "border-b-2 border-transparent text-[var(--ink-500)] hover:text-[var(--ink-700)]")}>
                {m === "login" ? "登录" : "注册"}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="mt-6 space-y-3.5">
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" required placeholder={reg ? "用户名（2–20 个字）" : "用户名"} className={input} />
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={reg ? "new-password" : "current-password"} required minLength={6} placeholder={reg ? "密码（至少 6 位，别用其他网站的）" : "密码"} className={input} />
            {err && <p className="text-[13px] text-[#d0342c]">{err}</p>}
            <button type="submit" disabled={busy} className="h-[54px] w-full rounded-[10px] bg-[var(--ink)] text-[16px] font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-50">
              {busy ? "请稍候…" : reg ? "注册，开始做题" : "登录"}
            </button>
          </form>
          <p className="mt-3 text-[12.5px] text-[var(--ink-500)]">{reg ? "这台设备上已有的数据会合并进新账号。" : "登录后生词、错题、笔记在各台设备上同步。"}</p>
          <Link to="/" replace onClick={guest} className="mt-8 inline-block text-[14px] font-medium underline decoration-[var(--line)] underline-offset-4 hover:decoration-[var(--ink)]">
            不登录，先用着 →
          </Link>
        </div>

        <div aria-hidden className="relative mt-16 flex justify-center pb-10 lg:hidden">
          <MockPaper small />
        </div>
      </div>
      <WelcomeSections />
    </div>
  );
}
