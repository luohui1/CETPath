import { useEffect, useState } from "react";
import { ACTIVE_ACCOUNT, writeActiveAccount, type ActiveAccount } from "./account";
import { startSync, stopSync } from "./sync";

/* 账号：用户名 + 密码，登录状态在 HttpOnly Cookie 里；本地库按稳定 uid 分库隔离 */
export type Me = ActiveAccount | null;
let me: Me | undefined = ACTIVE_ACCOUNT ?? undefined;
let meP: Promise<Me> | null = null;
const emit = () => dispatchEvent(new Event("yz-auth"));

export function loadMe(): Promise<Me> {
  if (!meP)
    meP = fetch("/api/auth/me")
      .then(async (r): Promise<{ status: number; user: ActiveAccount | null }> => {
        if (r.ok && (r.headers.get("content-type") || "").includes("json")) {
          const d = (await r.json()) as { uid?: number; name?: string };
          if (typeof d.uid === "number" && typeof d.name === "string" && d.name) {
            return { status: r.status, user: { uid: d.uid, name: d.name } };
          }
        }
        return { status: r.status, user: null };
      })
      .then(({ status, user }) => {
        if (user) {
          if (!ACTIVE_ACCOUNT || ACTIVE_ACCOUNT.uid !== user.uid) {
            writeActiveAccount(user);
            location.reload();
            return user;
          }
          if (ACTIVE_ACCOUNT.name !== user.name) writeActiveAccount(user);
          me = user;
          void startSync(user);
          emit();
          return user;
        }
        // 明确未登录（401）：若当前页面仍挂在某个旧账号库上，切回访客库并刷新
        if (status === 401 && ACTIVE_ACCOUNT) {
          stopSync();
          writeActiveAccount(null);
          location.reload();
          return null;
        }
        me = null;
        emit();
        return null;
      })
      .catch(() => {
        // 断网查不到：如果本地已有登录身份，保留离线使用该账号库；联网后再重查
        meP = null;
        if (ACTIVE_ACCOUNT) {
          me = ACTIVE_ACCOUNT;
          emit();
          return ACTIVE_ACCOUNT;
        }
        return null;
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

export async function signIn(name: string, password: string, register: boolean): Promise<ActiveAccount> {
  const r = await fetch(`/api/auth/${register ? "register" : "login"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password }),
  });
  const x = (await r.json().catch(() => ({ error: "服务器没响应" }))) as { uid?: number; name?: string; error?: string };
  if (!r.ok || typeof x.uid !== "number" || !x.name) throw new Error(x.error || "登录失败");
  const acc: ActiveAccount = { uid: x.uid, name: x.name };
  writeActiveAccount(acc);
  me = acc;
  meP = Promise.resolve(acc);
  return acc;
}

export async function signOut() {
  stopSync();
  const r = await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
  if (!r?.ok) throw new Error("退出失败，检查一下网络再试");
  writeActiveAccount(null);
  me = null;
  meP = Promise.resolve(null);
  location.replace("/welcome");
}

addEventListener("online", () => {
  meP = null;
  void loadMe();
});
