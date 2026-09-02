"use client";

import type { ReactNode } from "react";
import type { WorkbenchView } from "../lib/workbench-view";

export type WorkbenchApiStatus = "checking" | "cloud" | "demo" | "offline";

export type WorkbenchNavItem = {
  key: WorkbenchView;
  label: string;
  icon: string;
};

type WorkbenchLayoutProps = {
  activeView: WorkbenchView;
  apiStatus: WorkbenchApiStatus;
  isDemo: boolean;
  navItems: WorkbenchNavItem[];
  sidebarGoal: ReactNode;
  profile: ReactNode;
  attentionCount: number;
  children: ReactNode;
  overlays?: ReactNode;
  onNavigate: (view: WorkbenchView) => void;
  onRetryApiHealth: () => void;
  onOpenSearch: () => void;
  onOpenAttention: () => void;
  onOpenQuickCapture: () => void;
};

function syncStatusCopy(isDemo: boolean, apiStatus: WorkbenchApiStatus) {
  if (isDemo) return "离线演示模式";
  if (apiStatus === "cloud") return "Supabase 云端同步已连接";
  if (apiStatus === "demo") return "已登录 · 后端仍为临时仓库";
  if (apiStatus === "offline") return "数据服务未连接 · 点击重试";
  return "正在重新检查数据服务…";
}

export function WorkbenchLayout({
  activeView,
  apiStatus,
  isDemo,
  navItems,
  sidebarGoal,
  profile,
  attentionCount,
  children,
  overlays,
  onNavigate,
  onRetryApiHealth,
  onOpenSearch,
  onOpenAttention,
  onOpenQuickCapture,
}: WorkbenchLayoutProps) {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">研</span><div><strong>研途</strong><small>Agent Workbench</small></div></div>
        <nav aria-label="工作台主导航">{navItems.map((item) => <button key={item.key} className={activeView === item.key ? "active" : ""} onClick={() => onNavigate(item.key)}><span>{item.icon}</span>{item.label}</button>)}</nav>
        {sidebarGoal}
        {profile}
      </aside>
      <section className="main-content">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">研</span><strong>研途</strong></div>
          <button type="button" className={`sync-status ${isDemo ? "offline" : apiStatus}`} onClick={onRetryApiHealth} disabled={isDemo || apiStatus === "checking"} title={isDemo ? "离线演示模式不连接云端" : "点击立即重新检查云端连接"}><i /> {syncStatusCopy(isDemo, apiStatus)}</button>
          <div className="top-actions">
            <button className="global-search-trigger" aria-label="搜索" title="搜索（Ctrl/⌘ + K）" onClick={onOpenSearch}>⌕</button>
            <button className="attention-trigger" aria-label="待处理事项" onClick={onOpenAttention}>○{attentionCount > 0 && <span>{attentionCount > 99 ? "99+" : attentionCount}</span>}</button>
            <button className="quick-capture" onClick={onOpenQuickCapture}>＋ 快速记录</button>
          </div>
        </header>
        <div className="content-wrap">{children}</div>
        <nav className="mobile-nav" aria-label="移动端主导航">{navItems.slice(0, 5).map((item) => <button key={item.key} className={activeView === item.key ? "active" : ""} onClick={() => onNavigate(item.key)}><span>{item.icon}</span><small>{item.label.slice(0, 2)}</small></button>)}</nav>
      </section>
      {overlays}
    </main>
  );
}
