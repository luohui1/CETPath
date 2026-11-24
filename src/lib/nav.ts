import type { NavigateFunction } from "react-router";

type Click = { preventDefault(): void; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };

/** 返回键：站内是从别的页进来的就退回上一页（和系统返回手势一致，不会来回绕）；直接打开的才去 fallback */
export function goBack(navigate: NavigateFunction, fallback: string, e?: Click) {
  // Ctrl / Cmd / Shift 点、中键点：照链接本来的样子在新标签页打开
  if (e && ((e.button ?? 0) !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
  e?.preventDefault();
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx > 0) void navigate(-1);
  else void navigate(fallback, { replace: true });
}
