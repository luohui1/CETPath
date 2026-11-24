import { useState } from "react";
import { Key } from "@phosphor-icons/react";
import { activateAgent } from "@/lib/agent";

/** 没激活的设备：输一次激活码，记在这台设备上 */
export function AgentActivate() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setErr(await activateAgent(code));
    setBusy(false);
  };
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-10 text-center">
      <Key className="size-7 text-[var(--blue)]" weight="duotone" />
      <p className="text-[15px] font-semibold">输入激活码使用 Agent</p>
      <p className="text-[13px] leading-[20px] text-[var(--ink-500)]">
        每台设备输一次就记住了。激活码在设置页“Agent 模型”里查看。
      </p>
      <form
        className="flex w-full max-w-[280px] gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="激活码"
          autoComplete="off"
          aria-label="激活码"
          className="min-w-0 flex-1 rounded-[9px] border border-[var(--line)] bg-white px-3 py-2 text-[14px] outline-none focus:border-[var(--blue)]"
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="rounded-[9px] bg-[var(--blue)] px-4 text-[14px] font-medium text-white disabled:opacity-50"
        >
          激活
        </button>
      </form>
      {err && <p className="text-[13px] text-[var(--red)]">{err}</p>}
    </div>
  );
}
