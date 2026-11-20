import { useEffect, useState } from "react";
import { startSync, stopSync } from "./sync";

/* 账号：用户名 + 密码，登录状态在 HttpOnly Cookie 里（前端看不到），这里只记用户名 */
export type Me = { name: string } | null;
let me: Me | undefined;
let meP: Promise<Me> | null = null;
const emit = () => dispatchEvent(new Event("yz-auth"));

export function loadMe(): Promise<Me> {
  if (!meP)
    meP = fetch("/api/auth/me")
      .then(async (r) => (r.ok && (r.headers.get("content-type") || "").includes("json") ? ((await r.json()) as { name: string }) : null))
      .catch(() => null)
      .then((m) => {
        me = m;
        if (m) void startSync(m.name);
        emit();
        return m;
      });
  return meP;
}

export function useMe(): Me | undefined {
  const [v, setV] = useState<Me | undefined>(me);
  useEffect(() => {
    const on = () => setV(me);
    addEventListener("yz-auth", on);
    void loadMe();
    return () => removeEventListener("yz-auth", on);
  }, []);
  return v;
}

export async function signIn(name: string, password: string, register: boolean) {
  const r = await fetch(`/api/auth/${register ? "register" : "login"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, password }) });
  const x = await r.json().catch(() => ({ error: "服务器没响应" }));
  if (!r.ok) throw new Error(x.error || "登录失败");
  me = { name: x.name };
  meP = Promise.resolve(me);
  await startSync(x.name);
  emit();
  return me;
}

export async function signOut() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  stopSync();
  me = null;
  meP = Promise.resolve(null);
  emit();
}
