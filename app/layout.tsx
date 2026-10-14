import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "山海供 · 海外供货平台",
  description: "连接螺蛳湾好货与海外采购，商户免费入驻，维护商品与供货条件。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
