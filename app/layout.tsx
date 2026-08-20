import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '資產追蹤',
  description: '家庭資產追蹤:股票持股、銀行與券商帳戶餘額、資產配置與增長趨勢',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 不鎖縮放(無障礙考量),但配合 16px 的輸入框字級,iOS 不會自動放大畫面
  maximumScale: 5,
  viewportFit: 'cover', // 讓 env(safe-area-inset-*) 生效,底部分頁列才躲得開 Home Indicator
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1a19' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
