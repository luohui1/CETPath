import type { NavigateFunction } from "react-router";

/** 返回键：站内是从别的页进来的就退回上一页（和系统返回手势一致，不会来回绕）；直接打开的才去 fallback */
export function goBack(navigate: NavigateFunction, fallback: string, e?: { preventDefault(): void }) {
  e?.preventDefault();
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx > 0) void navigate(-1);
  else void navigate(fallback, { replace: true });
}
