import { Link } from "react-router";
import { Button, EmptyState } from "@/components/ui";

export function NotFoundPage() {
  return (
    <EmptyState
      title="页面不存在"
      desc="链接可能写错了，或者这个页面已经移走。"
      action={
        <Link to="/">
          <Button variant="primary">回到首页</Button>
        </Link>
      }
    />
  );
}
