import Link from 'next/link';
import { formatMoney, formatPercent, formatSignedCompact } from '@/lib/format';
import { shiftMonth, type DailyPnl } from '@/lib/pnl';

/**
 * 每日盈虧月曆。
 *
 * 顏色照台股慣例:紅漲綠跌(`--gain` / `--loss`)。底色深淺表示幅度大小,
 * 強度是相對於當月最大波動,所以每個月各自看得出哪幾天特別劇烈。
 *
 * 純 Server Component ——  月份切換靠連結,不需要任何 client JS。
 */

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function Arrow({ dir }: { dir: 'prev' | 'next' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path
        d={dir === 'prev' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function PnlCalendar({
  month,
  weeks,
  byDate,
  today,
  scope,
  total,
}: {
  month: string;
  weeks: (string | null)[][];
  byDate: Map<string, DailyPnl>;
  today: string;
  scope: string;
  total: { pnl: number; days: number };
}) {
  const [year, mon] = month.split('-');
  const href = (m: string) => `/calendar?month=${m}${scope === 'family' ? '&scope=family' : ''}`;

  // 深淺是相對於當月最大波動 —— 平穩的月份不會整片死白,劇烈的月份也不會整片濃色
  const maxAbs = Math.max(
    1,
    ...[...byDate.values()].map((d) => (d.pnl === null ? 0 : Math.abs(d.pnl)))
  );

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link href={href(shiftMonth(month, -1))} className="btn btn-ghost px-2" aria-label="上個月">
            <Arrow dir="prev" />
          </Link>
          <span className="tnum text-sm font-semibold">
            {year} 年 {Number(mon)} 月
          </span>
          <Link href={href(shiftMonth(month, 1))} className="btn btn-ghost px-2" aria-label="下個月">
            <Arrow dir="next" />
          </Link>
        </div>

        <div className="text-right">
          <div className="eyebrow">當月合計</div>
          <div className={`tnum text-sm font-semibold ${total.pnl >= 0 ? 'pos' : 'neg'}`}>
            {total.days === 0 ? '—' : formatSignedCompact(total.pnl)}
          </div>
        </div>
      </div>

      <div className="cal-grid">
        {WEEKDAYS.map((w) => (
          <div key={w} className="cal-weekday">
            {w}
          </div>
        ))}

        {weeks.flat().map((date, i) => {
          if (date === null) {
            return <div key={`empty-${i}`} className="cal-cell" data-empty="true" />;
          }

          const row = byDate.get(date);
          const pnl = row?.pnl ?? null;
          const tone = pnl === null ? undefined : pnl >= 0 ? 'gain' : 'loss';
          const intensity = pnl === null ? 0 : Math.abs(pnl) / maxAbs;

          return (
            <div
              key={date}
              className="cal-cell"
              data-today={date === today}
              data-tone={tone}
              style={{ '--cal-intensity': intensity } as React.CSSProperties}
              title={
                pnl === null
                  ? `${date} 沒有資料`
                  : `${date} ${formatMoney(pnl)}${row?.percent !== null && row?.percent !== undefined ? `(${formatPercent(row.percent)})` : ''}`
              }
            >
              <span className="cal-date">{Number(date.slice(-2))}</span>

              {pnl !== null && (
                <>
                  <span className={`cal-amount ${pnl >= 0 ? 'pos' : 'neg'}`}>
                    {formatSignedCompact(pnl)}
                  </span>
                  {row?.percent !== null && row?.percent !== undefined && (
                    <span className="cal-percent hidden sm:block">
                      {formatPercent(row.percent)}
                    </span>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        空白的日子代表沒有資料可比 —— 週末與假日沒有交易,或那天還在你的第一筆持有起始日之前。
        存款、提款、帳戶間轉帳與買賣股票的交割都已經從盈虧中扣除,顯示的是純粹的市值變化。
      </p>
    </section>
  );
}
