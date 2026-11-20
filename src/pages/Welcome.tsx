import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { LogoMark } from "@/components/Logo";
import { PaperThumb, Stamp } from "@/components/paper-ui";
import { signIn } from "@/lib/auth";
import { cn } from "@/lib/utils";

const COVER = "cet6-2026-06-1";
const LINES = [
  ["真题", "四六级、考研真卷原样打开，可以手写、计时、交卷看解析"],
  ["复盘", "做完和 Agent 聊，它看得到你的作答、错题和用时"],
  ["外刊", "VOA 和 The Conversation 每天更新，带译文和查词"],
  ["同步", "登录后，生词、错题、笔记在各台设备上都一样"],
];

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
  const input = "mt-2 h-11 w-full rounded-[8px] border border-[var(--line)] bg-white px-3 text-[15px] outline-none transition-colors focus:border-[var(--ink-700)]";

  return (
    <div className="min-h-dvh bg-[var(--paper,#f6f4ee)] text-[var(--ink)]">
      <div className="mx-auto grid min-h-dvh max-w-[1080px] lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex flex-col px-8 pt-10 pb-12 lg:border-r lg:border-[var(--line)] lg:pr-14">
          <div className="flex items-center gap-2">
            <LogoMark className="size-7" />
            <span className="font-serif text-[18px] font-semibold">英语之道</span>
          </div>
          <div className="mt-14 flex items-end gap-8 max-sm:flex-col max-sm:items-start lg:mt-20">
            <div className="relative shrink-0">
              <PaperThumb id={COVER} width={168} fan />
              <Stamp tone="red" className="absolute -right-5 -bottom-3 rotate-[-8deg]">真题</Stamp>
            </div>
            <div>
              <h1 className="font-serif text-[34px] leading-[1.25] font-semibold">四六级 · 考研<br />真题和外刊</h1>
              <p className="mt-3 text-[15px] leading-[1.7] text-[var(--ink-500)]">在卷子上做题、写笔记，做完找 Agent 复盘。</p>
            </div>
          </div>
          <dl className="mt-14 max-w-[560px] border-t border-[var(--line)]">
            {LINES.map(([k, v]) => (
              <div key={k} className="flex gap-6 border-b border-[var(--line)] py-3.5 text-[14.5px]">
                <dt className="w-10 shrink-0 font-serif font-semibold">{k}</dt>
                <dd className="text-[var(--ink-700)]">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="flex flex-col justify-center px-8 py-12 lg:pl-14">
          <div className="flex gap-6 font-serif text-[22px] font-semibold">
            {(["login", "register"] as const).map((m) => (
              <button key={m} type="button" onClick={() => (setMode(m), setErr(null))} className={cn("pb-1 transition-colors", mode === m ? "border-b-2 border-[var(--ink)] text-[var(--ink)]" : "border-b-2 border-transparent text-[var(--ink-400,#9aa1ad)] hover:text-[var(--ink-700)]")}>
                {m === "login" ? "登录" : "注册"}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="mt-8 space-y-5">
            <label className="block text-[13px] text-[var(--ink-700)]">
              用户名
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" required className={input} />
              {reg && <span className="mt-1.5 block text-[12px] text-[var(--ink-500)]">2–20 个字，中英文、数字或下划线</span>}
            </label>
            <label className="block text-[13px] text-[var(--ink-700)]">
              密码
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={reg ? "new-password" : "current-password"} required minLength={6} className={input} />
              {reg && <span className="mt-1.5 block text-[12px] text-[var(--ink-500)]">至少 6 位。网站是 http，别用其他网站的密码</span>}
            </label>
            {err && <p className="text-[13px] text-[var(--red,#c43)]">{err}</p>}
            <button type="submit" disabled={busy} className="h-11 w-full rounded-[8px] bg-[var(--ink)] text-[15px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50">
              {busy ? "请稍候…" : reg ? "注册" : "登录"}
            </button>
          </form>
          <p className="mt-4 text-[12.5px] leading-[1.6] text-[var(--ink-500)]">{reg ? "这台设备上已有的数据会合并进新账号。" : "没有账号？点上面的"}{!reg && <button type="button" onClick={() => setMode("register")} className="text-[var(--ink)] underline underline-offset-2">注册</button>}</p>
          <Link to="/" replace onClick={guest} className="mt-10 text-[14px] text-[var(--ink-700)] underline-offset-4 hover:underline">
            不登录，先用着 →
          </Link>
          <p className="mt-1.5 text-[12px] text-[var(--ink-500)]">数据只存在这台设备上，以后可以在设置里登录。</p>
        </section>
      </div>
    </div>
  );
}
