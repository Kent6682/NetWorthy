import Link from 'next/link';
import { formatMoney, formatNumber, formatPercent, formatSignedCompact } from '@/lib/format';
import { holidayLabel, shiftMonth, type DailyPnl, type MonthSummary } from '@/lib/pnl';

/**
 * 每日盈虧月曆。
 *
 * 顏色照台股慣例:紅漲綠跌(`--gain` / `--loss`)。底色深淺表示幅度大小,
 * 強度是相對於當月最大波動,所以每個月各自看得出哪幾天特別劇烈。
 *
 * 純 Server Component ——  月份切換靠連結,不需要任何 client JS。
 */

// 只排平日 —— 週末沒有開盤,留著只是佔版面
const WEEKDAYS = ['一', '二', '三', '四', '五'];

/** 滑鼠停留時的完整說明 —— 格子太小,細節放這裡 */
function describeDay(date: string, row: DailyPnl | undefined, holiday?: string): string {
  const parts: string[] = [date];

  if (holiday) {
    parts.push(`${holiday},休市`);
  } else if (row?.closed) {
    parts.push('休市');
  } else if (row?.pending) {
    parts.push('收盤價還沒抓到,等下一次同步');
  } else if (row?.trades && row.trades.initial > 0) {
    parts.push(`導入 ${row.trades.initial} 檔既有持股(當天不計盈虧)`);
  } else if (row?.pnl === null || row?.pnl === undefined) {
    parts.push('沒有資料可比');
  } else {
    const percent =
      row.percent === null ? '' : `(${formatPercent(row.percent)})`;
    parts.push(`${formatMoney(row.pnl)}${percent}`);
  }

  const actions: string[] = [];
  if (row?.trades?.buy) actions.push(`買進 ${row.trades.buy} 筆`);
  if (row?.trades?.sell) actions.push(`賣出 ${row.trades.sell} 筆`);
  if (actions.length > 0) parts.push(actions.join('、'));

  return parts.join(' · ');
}

/** 帶正負號的完整金額:+123,456 / −8,450 / 0 */
function signedFull(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return '0';
  return `${rounded > 0 ? '+' : '−'}${formatNumber(Math.abs(rounded))}`;
}

/** 賺紅賠綠,剛好 0 不上色 */
function toneClass(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? 'pos' : rounded < 0 ? 'neg' : '';
}

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
  selectedDay,
  holidays,
}: {
  month: string;
  weeks: (string | null)[][];
  byDate: Map<string, DailyPnl>;
  today: string;
  scope: string;
  total: MonthSummary;
  selectedDay?: string;
  /** 休市日 → 節日名稱 */
  holidays: Map<string, string>;
}) {
  const [year, mon] = month.split('-');
  const tail = scope === 'family' ? '&scope=family' : '';
  const href = (m: string) => `/calendar?month=${m}${tail}`;
  const dayHref = (d: string) => `/calendar?month=${month}&day=${d}${tail}#day-detail`;

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

        <div className="min-w-0 text-right">
          <div className="eyebrow">{Number(mon)} 月合計</div>
          {total.days === 0 ? (
            <div className="tnum text-base font-semibold">—</div>
          ) : (
            <>
              <div className={`tnum text-base font-semibold leading-snug ${toneClass(total.pnl)}`}>
                {signedFull(total.pnl)}
                {total.percent !== null && (
                  <span className="ml-1.5 text-xs font-medium">{formatPercent(total.percent, 2)}</span>
                )}
              </div>
              <div className="eyebrow tnum">
                漲 {total.up} 天 · 跌 {total.down} 天
              </div>
            </>
          )}
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
          const holiday = holidays.get(date);
          const pnl = row?.pnl ?? null;
          const trades = row?.trades ?? null;
          const imported = (trades?.initial ?? 0) > 0;
          const tone = pnl === null ? undefined : pnl >= 0 ? 'gain' : 'loss';
          const intensity = pnl === null ? 0 : Math.abs(pnl) / maxAbs;

          return (
            <Link
              key={date}
              href={dayHref(date)}
              scroll={false}
              className="cal-cell"
              data-today={date === today}
              data-selected={date === selectedDay}
              data-holiday={holiday !== undefined}
              data-tone={tone}
              style={{ '--cal-intensity': intensity } as React.CSSProperties}
              title={describeDay(date, row, holiday)}
            >
              {trades && (
                <span className="cal-marks">
                  {trades.initial > 0 && <span className="cal-mark" data-kind="initial" />}
                  {trades.buy > 0 && <span className="cal-mark" data-kind="buy" />}
                  {trades.sell > 0 && <span className="cal-mark" data-kind="sell" />}
                </span>
              )}

              <span className="cal-date">{Number(date.slice(-2))}</span>

              {holiday ? (
                <span className="cal-holiday">{holidayLabel(holiday)}</span>
              ) : row?.closed ? (
                <span className="cal-imported">休市</span>
              ) : row?.pending ? (
                <span className="cal-imported">待更新</span>
              ) : imported ? (
                <span className="cal-imported">導入</span>
              ) : (
                pnl !== null && (
                  <>
                    <span className={`cal-amount ${pnl >= 0 ? 'pos' : 'neg'}`}>
                      {formatSignedCompact(pnl)}
                    </span>
                    {row?.percent !== null && row?.percent !== undefined && (
                      <span className="cal-percent">{formatPercent(row.percent)}</span>
                    )}
                  </>
                )
              )}
            </Link>
          );
        })}
      </div>

      <div
        className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs"
        style={{ color: 'var(--text-muted)' }}
      >
        <span className="flex items-center gap-1.5">
          <span className="cal-mark" data-kind="buy" />買進
        </span>
        <span className="flex items-center gap-1.5">
          <span className="cal-mark" data-kind="sell" />賣出
        </span>
        <span className="flex items-center gap-1.5">
          <span className="cal-mark" data-kind="initial" />導入既有持股
        </span>
      </div>

      <p className="mt-2.5 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        顯示的是<strong style={{ color: 'var(--text-secondary)' }}>股票市值</strong>的變化,
        已經扣掉當天買賣造成的部位變動 ——
        買進 50 萬不是賺 50 萬,那只是現金換成股票;手續費與稅則算成當天的損失。
        導入既有持股的那天不計盈虧,因為那天你既沒賺也沒賠。
        月合計是當月每一格的加總,百分比的分母是上個月底的股票市值。
        它跟總覽「年度損益」的數字會有一點差距:日曆在導入既有持股那天不算盈虧,年度表則是跟你輸入的成本比。
        國定假日會寫上節日名稱(來自證交所的年度行事曆)。
        空白的日子是沒有資料可比 —— 還沒到,或還在第一筆持有起始日之前。
      </p>
    </section>
  );
}
