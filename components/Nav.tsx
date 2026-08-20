'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from '@/app/actions/auth';

/**
 * 導覽
 *   手機:底部固定四分頁(拇指觸及範圍),頂部只留標題與登出
 *   桌機:頂部橫向導覽,底部分頁列隱藏
 */

const ICONS = {
  overview: (
    <path d="M3 12l9-8 9 8M5 10v9h5v-6h4v6h5v-9" strokeLinecap="round" strokeLinejoin="round" />
  ),
  stocks: (
    <path d="M3 17l5-6 4 3.5L21 6M21 6h-5m5 0v5" strokeLinecap="round" strokeLinejoin="round" />
  ),
  accounts: (
    <>
      <rect x="2.5" y="6" width="19" height="13" rx="2.5" />
      <path d="M2.5 10.5h19" strokeLinecap="round" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
        strokeLinecap="round"
      />
    </>
  ),
};

const LINKS = [
  { href: '/', label: '總覽', icon: ICONS.overview },
  { href: '/stocks', label: '股票', icon: ICONS.stocks },
  { href: '/accounts', label: '帳戶', icon: ICONS.accounts },
  { href: '/settings', label: '設定', icon: ICONS.settings },
];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export default function Nav({ displayName }: { displayName: string }) {
  const pathname = usePathname();

  return (
    <>
      {/* 頂部 ------------------------------------------------------------ */}
      <header
        className="sticky top-0 z-30"
        style={{
          background: 'var(--surface-1)',
          borderBottom: '1px solid var(--hairline-ring)',
        }}
      >
        <div className="container-app flex h-14 items-center gap-6">
          <span className="text-[15px] font-semibold tracking-tight">資產追蹤</span>

          {/* 桌機分頁 */}
          <nav className="hidden flex-1 gap-0.5 md:flex">
            {LINKS.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className="rounded-lg px-3 py-1.5 text-sm transition-colors"
                  style={{
                    background: active ? 'var(--surface-sunken)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3 md:ml-0">
            <span className="hidden text-xs sm:inline" style={{ color: 'var(--text-muted)' }}>
              {displayName}
            </span>
            <form action={signOut}>
              <button type="submit" className="btn btn-ghost text-xs">
                登出
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* 手機底部分頁列 --------------------------------------------------- */}
      <nav className="tabbar" aria-label="主要導覽">
        {LINKS.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className="tabbar-item"
              data-active={active}
              aria-current={active ? 'page' : undefined}
            >
              <Icon>{link.icon}</Icon>
              <span>{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
