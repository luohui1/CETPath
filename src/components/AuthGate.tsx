import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { loadMe } from "@/lib/auth";

/** 启动时查一下登录状态（登录了就开始同步）；没登录、也没选过"先不登录"的，打开首页先去落地页 */
export function AuthGate() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    void loadMe().then((m) => {
      if (!m && pathname === "/" && !localStorage.getItem("yz-guest")) nav("/welcome", { replace: true });
    });
    // 只在打开应用时判断一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
