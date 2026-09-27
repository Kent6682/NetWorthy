import Link from 'next/link';
import { formatSignedCompact } from '@/lib/format';
import type { MonthSummary } from '@/lib/pnl';

/**
 * 日曆上方的「整年 12 個月」列:每月一格盈虧,點一下跳到那個月。
 *
 * 每一格就是那個月日曆格子的加總(lib/pnl.ts 的 summarizeMonths),
 * 跟下面的月曆用同一份資料,所以一定對得上。
 *
 * 手機 4 × 3、桌機一排 12 格,都不需要左右滑。
 */
export default function MonthStrip({
  year,
  months,
  selectedMonth,
  today,
  scope,
}: {
  year: string;
  months: Map<string, MonthSummary>;
  selectedMonth: string;
  today: string;
  scope: string;
}) {
  const tail = scope === 'family' ? '&scope=family' : '';
  const thisMonth = today.slice(0, 7);
  const keys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

  const withData = keys.filter((k) => (months.get(k)?.days ?? 0) > 0);
  const yearPnl = withData.reduce((sum, k) => sum + months.get(k)!.pnl, 0);
  const yearTone = Math.round(yearPnl) > 0 ? 'pos' : Math.round(yearPnl) < 0 ? 'neg' : '';

  return (
    <section className="month-strip" aria-label={`${year} 年各月盈虧`}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="eyebrow">{year} 年各月盈虧</span>
        <span className="flex items-baseline gap-2">
          <span className="eyebrow">{year === today.slice(0, 4) ? '今年合計' : '全年合計'}</span>
          <span className={`tnum text-sm font-semibold ${yearTone}`}>
            {withData.length === 0 ? '—' : formatSignedCompact(yearPnl)}
          </span>
        </span>
      </div>

      <div className="month-strip-grid">
        {keys.map((key) => {
          const summary = months.get(key);
          const has = (summary?.days ?? 0) > 0;
          const pnl = summary?.pnl ?? 0;
          const rounded = Math.round(pnl);
          const tone = !has ? '' : rounded > 0 ? 'pos' : rounded < 0 ? 'neg' : '';

          return (
            <Link
              key={key}
              href={`/calendar?month=${key}${tail}`}
              scroll={false}
              className="month-strip-cell"
              data-current={key === selectedMonth}
              data-future={key > thisMonth}
              aria-current={key === selectedMonth ? 'date' : undefined}
              title={
                has
                  ? `${Number(key.slice(5))} 月:${formatSignedCompact(pnl)},${summary!.days} 個交易日`
                  : `${Number(key.slice(5))} 月:沒有資料`
              }
            >
              <span className="month-strip-label">{Number(key.slice(5))}月</span>
              <span className={`tnum month-strip-value ${tone}`}>
                {has ? formatSignedCompact(pnl) : '—'}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
