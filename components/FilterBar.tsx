'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { RANGE_OPTIONS } from '@/lib/portfolio';

/**
 * 一整排篩選器放在所有圖表上方,所有圖表共用同一組條件重新繪製。
 * 不在個別圖表卡片內放篩選器。
 *
 * 手機:期間選項可橫向滑動,不換行擠壓版面。
 */
export default function FilterBar({
  scope,
  range,
  showScopeToggle,
  showRange = true,
}: {
  scope: 'me' | 'family';
  range?: string;
  showScopeToggle: boolean;
  showRange?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (!showScopeToggle && !showRange) return null;

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, value);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="mb-4 flex flex-col gap-2.5 sm:mb-5 sm:flex-row sm:items-center sm:gap-4">
      {showScopeToggle && (
        <div
          className="inline-flex self-start rounded-lg p-0.5"
          style={{ background: 'var(--surface-sunken)' }}
          role="group"
          aria-label="視角"
        >
          {(
            [
              { key: 'me', label: '個人' },
              { key: 'family', label: '全家' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setParam('scope', opt.key)}
              aria-pressed={scope === opt.key}
              className="rounded-md px-5 py-1.5 text-sm transition-all"
              style={{
                background: scope === opt.key ? 'var(--surface-1)' : 'transparent',
                color: scope === opt.key ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: scope === opt.key ? 500 : 400,
                boxShadow: scope === opt.key ? 'var(--shadow-card)' : 'none',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {showRange && (
        <div
          className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0"
          style={{ scrollbarWidth: 'none' }}
          role="group"
          aria-label="期間"
        >
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setParam('range', opt.key)}
              aria-pressed={range === opt.key}
              className="shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors"
              style={{
                background: range === opt.key ? 'var(--surface-sunken)' : 'transparent',
                color: range === opt.key ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: range === opt.key ? 500 : 400,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
