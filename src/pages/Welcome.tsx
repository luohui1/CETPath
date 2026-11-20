import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, BookOpenText, CloudArrowUp, Exam, Newspaper, Sparkle } from "@phosphor-icons/react";
import { LogoMark } from "@/components/Logo";
import { signIn } from "@/lib/auth";
import { cn } from "@/lib/utils";

const FEATURES = [
  { Icon: Exam, title: "真题直接做", desc: "四六级、考研真卷原样打开，计时、作答、交卷、看解析一气呵成。" },
  { Icon: Sparkle, title: "Agent 陪你复盘", desc: "看得到你错了哪、每题用了多久，讲到你懂为止，还会记住你的薄弱点。" },
  { Icon: Newspaper, title: "每天的外刊", desc: "VOA、The Conversation 每天更新，查词、译文、长难句解析都在原文上。" },
  { Icon: CloudArrowUp, title: "多设备同步", desc: "生词、错题、笔记、做题记录登录后自动同步，平板写完电脑接着看。" },
];

export function WelcomePage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await signIn(name.trim(), pw, mode === "register");
      nav("/", { replace: true });
    } catch (x) {
      setErr(x instanceof Error ? x.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };
  const guest = () => {
    localStorage.setItem("yz-guest", "1");
    nav("/", { replace: true });
  };

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[var(--paper-50,#f7f6f2)] text-[var(--ink)]">
      <div aria-hidden className="pointer-events-none absolute -top-40 -right-40 size-[560px] rounded-full bg-[radial-gradient(closest-side,rgba(43,109,229,0.16),transparent)]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-48 -left-32 size-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(255,206,84,0.22),transparent)]" />
      <header className="relative mx-auto flex max-w-[1180px] items-center gap-2.5 px-6 pt-6">
        <LogoMark className="size-8" />
        <span className="text-[17px] font-semibold tracking-tight">英语之道</span>
      </header>
      <main className="relative mx-auto grid max-w-[1180px] items-center gap-12 px-6 pt-10 pb-16 lg:grid-cols-[minmax(0,1.15fr)_420px] lg:pt-20">
        <section>
          <p className="animate-pop inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-[13px] font-medium text-[var(--blue)] shadow-[inset_0_0_0_1px_var(--line-soft)]">
            <BookOpenText className="size-4" weight="duotone" /> 四六级 · 考研 · 外刊
          </p>
          <h1 className="serif mt-5 text-[40px] leading-[1.15] font-semibold tracking-tight sm:text-[52px]">
            做真题，<span className="relative whitespace-nowrap">
              <span className="relative z-[1]">弄懂每一题</span>
              <span aria-hidden className="absolute inset-x-0 bottom-1.5 h-3.5 rounded-sm bg-[rgba(255,214,90,0.6)]" />
            </span>
          </h1>
          <p className="mt-5 max-w-[34em] text-[17px] leading-[1.75] text-[var(--ink-700)]">像在纸上一样做卷子、写笔记；做完和 Agent 一起复盘。它知道你哪错了、为什么错，下一次就不再错。</p>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2">
            {FEATURES.map(({ Icon, title, desc }, i) => (
              <li key={title} className="animate-pop rounded-[16px] bg-white/75 p-4 shadow-[inset_0_0_0_1px_var(--line-soft),0_1px_2px_rgba(15,31,56,0.04)] backdrop-blur" style={{ animationDelay: `${80 * i}ms`, animationFillMode: "both" }}>
                <Icon className="size-6 text-[var(--blue)]" weight="duotone" />
                <h3 className="mt-2.5 text-[15px] font-semibold">{title}</h3>
                <p className="mt-1 text-[13.5px] leading-[1.65] text-[var(--ink-500)]">{desc}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="animate-pop rounded-[22px] bg-white p-7 shadow-[0_24px_60px_-20px_rgba(15,31,56,0.25),inset_0_0_0_1px_var(--line-soft)]">
          <div className="relative grid grid-cols-2 rounded-[12px] bg-[var(--fill-quiet,#f1f2f4)] p-1 text-[14px] font-medium">
            <span aria-hidden className={cn("absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-[9px] bg-white shadow-[0_1px_3px_rgba(15,31,56,0.12)] transition-transform duration-500 [transition-timing-function:cubic-bezier(.3,1.3,.5,1)]", mode === "register" && "translate-x-full")} />
            {(["login", "register"] as const).map((m) => (
              <button key={m} type="button" onClick={() => (setMode(m), setErr(null))} className={cn("relative h-9 rounded-[9px] transition-colors", mode === m ? "text-[var(--ink)]" : "text-[var(--ink-500)]")}>
                {m === "login" ? "登录" : "注册"}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-[13px] font-medium text-[var(--ink-700)]">用户名</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" required className="mt-1.5 h-11 w-full rounded-[11px] bg-[var(--paper-50,#f7f6f2)] px-3.5 text-[15px] shadow-[inset_0_0_0_1px_var(--line)] transition-shadow outline-none focus:shadow-[inset_0_0_0_1.5px_var(--blue),0_0_0_4px_var(--blue-tint)]" placeholder={mode === "register" ? "2-20 个字，中英文、数字、下划线" : ""} />
            </label>
            <label className="block">
              <span className="text-[13px] font-medium text-[var(--ink-700)]">密码</span>
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={6} className="mt-1.5 h-11 w-full rounded-[11px] bg-[var(--paper-50,#f7f6f2)] px-3.5 text-[15px] shadow-[inset_0_0_0_1px_var(--line)] transition-shadow outline-none focus:shadow-[inset_0_0_0_1.5px_var(--blue),0_0_0_4px_var(--blue-tint)]" placeholder={mode === "register" ? "至少 6 位，别和其他网站一样" : ""} />
            </label>
            {err && <p className="animate-pop rounded-[10px] bg-[rgba(214,69,69,0.08)] px-3 py-2 text-[13px] text-[var(--red,#c43)]">{err}</p>}
            <button type="submit" disabled={busy} className="group flex h-11 w-full items-center justify-center gap-1.5 rounded-[11px] bg-[var(--blue)] text-[15px] font-medium text-white shadow-[0_8px_20px_-8px_rgba(43,109,229,0.7)] transition-transform active:scale-[0.98] disabled:opacity-60">
              {busy ? "请稍候…" : mode === "login" ? "登录" : "注册并登录"}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </form>
          <p className="mt-4 text-[12.5px] leading-[1.6] text-[var(--ink-500)]">{mode === "register" ? "本机已有的生词、错题、笔记会自动合并进新账号。" : "登录后生词、错题、笔记、做题记录会在多台设备间同步。"}</p>
          <div className="my-5 h-px bg-[var(--line-soft)]" />
          <button type="button" onClick={guest} className="w-full text-center text-[14px] font-medium text-[var(--ink-700)] transition-colors hover:text-[var(--blue)]">
            先不登录，直接用 →
          </button>
          <p className="mt-2 text-center text-[12px] text-[var(--ink-500)]">数据只存在这台设备上，之后随时可以在<Link to="/settings" onClick={() => localStorage.setItem("yz-guest", "1")} className="text-[var(--blue)]">设置</Link>里登录</p>
        </section>
      </main>
    </div>
  );
}
