import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "研途 · AI 考研工作台",
  description: "面向 2028 考研的双 Agent 学习工作台，记录每一次专注与成长。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
