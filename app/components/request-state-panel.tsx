import type { ReactNode } from "react";

export type RequestState = "loading" | "ready" | "empty" | "error";

type RequestStatePanelProps = {
  state: RequestState;
  loadingText: string;
  emptyTitle: string;
  emptyDescription: string;
  errorText?: string | null;
  children: ReactNode;
};

export function RequestStatePanel({
  state,
  loadingText,
  emptyTitle,
  emptyDescription,
  errorText,
  children,
}: RequestStatePanelProps) {
  if (state === "ready") return children;
  if (state === "loading") {
    return <div className="panel plan-empty request-state cloud-loading-text" role="status">{loadingText}</div>;
  }
  if (state === "error") {
    return <div className="panel plan-empty request-state error" role="alert"><strong>数据暂时不可用</strong><span>{errorText || "请检查云端连接后重试，已有数据不会受到影响。"}</span></div>;
  }
  return <div className="panel plan-empty request-state"><strong>{emptyTitle}</strong><span>{emptyDescription}</span></div>;
}
