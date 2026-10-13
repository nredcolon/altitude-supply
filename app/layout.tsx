import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "螺蛳湾 · 海外供货平台",
  description: "商户免费入驻，建立标准 SKU 与多商户供货货盘。",
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
