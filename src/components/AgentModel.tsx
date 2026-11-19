import { useEffect, useState } from "react";
import { resetAgentStatus } from "@/lib/agent";
import { Button } from "@/components/ui";

type Cfg = { base_url?: string; model?: string; temperature?: number | null; api_key_set?: boolean; api_key_tail?: string; error?: string; reply?: string; ms?: number };

async function api(path: string, body?: unknown, method?: string): Promise<[number, Cfg]> {
  try {
    const r = await fetch(path, { method: method ?? (body ? "POST" : "GET"), headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    let d: Cfg = {};
    try {
      d = await r.json();
    } catch {
      /* 后端没部署时是 nginx 的错误页 */
    }
    return [r.status, d];
  } catch {
    return [0, {}];
  }
}

const field = "h-10 w-full rounded-[9px] bg-white px-3 text-[14px] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)]";

/** 设置页的 Agent 模型：OpenAI 兼容接口的地址、模型名、密钥。存在服务器上，改之前要输后台密码 */
export function AgentModel() {
  const [state, setState] = useState<"loading" | "login" | "form" | "off">("loading");
  const [pw, setPw] = useState("");
  const [f, setF] = useState({ base_url: "", model: "", api_key: "", temperature: "" });
  const [keyInfo, setKeyInfo] = useState<{ set: boolean; tail: string }>({ set: false, tail: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [s, d] = await api("/api/admin/config");
    if (s === 401) return setState("login");
    if (s !== 200) return setState("off");
    setF({ base_url: d.base_url ?? "", model: d.model ?? "", api_key: "", temperature: d.temperature == null ? "" : String(d.temperature) });
    setKeyInfo({ set: !!d.api_key_set, tail: d.api_key_tail ?? "" });
    setState("form");
  };
  useEffect(() => {
    void load();
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    await fn();
    setBusy(false);
  };
  const login = () =>
    run(async () => {
      const [s, d] = await api("/api/admin/login", { password: pw });
      if (s === 200) {
        setPw("");
        await load();
      } else setMsg({ ok: false, text: d.error ?? "登录失败" });
    });
  const save = () =>
    run(async () => {
      const t = f.temperature.trim();
      const [s, d] = await api("/api/admin/config", { base_url: f.base_url, model: f.model, api_key: f.api_key, temperature: t ? Number(t) : null }, "PUT");
      if (s === 401) return setState("login");
      if (s !== 200) return setMsg({ ok: false, text: d.error ?? "保存失败" });
      resetAgentStatus();
      await load();
      setMsg({ ok: true, text: "已保存。点“测试连接”确认能用" });
    });
  const test = () =>
    run(async () => {
      const [s, d] = await api("/api/admin/test", {});
      if (s === 401) return setState("login");
      setMsg(s === 200 ? { ok: true, text: `连接成功（${((d.ms ?? 0) / 1000).toFixed(1)} 秒）：${d.reply ?? ""}` } : { ok: false, text: d.error ?? "连接失败" });
    });
  const logout = () =>
    run(async () => {
      const [s] = await api("/api/admin/logout", {});
      if (s === 200) setState("login");
      else setMsg({ ok: false, text: "退出没成功，请重试" });
    });

  const note = msg && <p className={`text-[13px] leading-5 ${msg.ok ? "text-[var(--green,#16a34a)]" : "text-[var(--red,#dc2626)]"}`}>{msg.text}</p>;

  if (state === "loading") return <p className="px-5 py-4 text-[13px] text-[var(--ink-500)]">读取中…</p>;
  if (state === "off") return <p className="px-5 py-4 text-[13px] leading-[21px] text-[var(--ink-700)]">服务器上还没有 Agent 后台服务，部署后才能在这里设置模型。</p>;
  if (state === "login")
    return (
      <div className="space-y-3 px-5 py-4">
        <p className="text-[13px] leading-[21px] text-[var(--ink-700)]">模型设置存在服务器上，修改前先输入后台密码。</p>
        <div className="flex gap-2">
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && pw && void login()} placeholder="后台密码" aria-label="后台密码" className={field} />
          <Button variant="primary" onClick={login} loading={busy} disabled={!pw}>
            登录
          </Button>
        </div>
        {note}
      </div>
    );
  return (
    <div className="space-y-3 px-5 py-4">
      <label className="block space-y-1.5">
        <span className="text-[13px] font-medium">接口地址（到 /v1 为止）</span>
        <input value={f.base_url} onChange={(e) => setF({ ...f, base_url: e.target.value })} placeholder="https://api.deepseek.com/v1" className={field} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-[13px] font-medium">模型名</span>
        <input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} placeholder="deepseek-chat" className={field} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-[13px] font-medium">API Key</span>
        <input type="password" autoComplete="off" value={f.api_key} onChange={(e) => setF({ ...f, api_key: e.target.value })} placeholder={keyInfo.set ? `已保存（…${keyInfo.tail}），不改就留空` : "sk-..."} className={field} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-[13px] font-medium">温度（可不填）</span>
        <input inputMode="decimal" value={f.temperature} onChange={(e) => setF({ ...f, temperature: e.target.value })} placeholder="0.3" className={`${field} max-w-[120px]`} />
      </label>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="primary" onClick={save} loading={busy}>
          保存
        </Button>
        <Button onClick={test} disabled={busy}>
          测试连接
        </Button>
        <Button onClick={logout} disabled={busy} className="ml-auto">
          退出登录
        </Button>
      </div>
      {note}
      <p className="text-[12px] leading-5 text-[var(--ink-500)]">密钥只存在服务器上，网页拿不到。站点还是 http，密码和密钥是明文传的，上 https 之前别用常用密码。</p>
    </div>
  );
}
