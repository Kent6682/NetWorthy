import { Suspense } from 'react';
import DayDetail from '@/components/DayDetail';
import FilterBar from '@/components/FilterBar';
import MonthStrip from '@/components/MonthStrip';
import PnlCalendar from '@/components/PnlCalendar';
import { todayInTaipei } from '@/lib/format';
import {
  buildPriceLookup,
  computeDailyPnl,
  computeHoldingPnl,
  groupTradesByDate,
  monthGrid,
  monthTotal,
  parseDay,
  parseMonth,
  previousDay,
  summarizeMonths,
  weekdaysInMonth,
  type DailyPnl,
} from '@/lib/pnl';
import {
  getHolidays,
  getPricesInRange,
  getSession,
  getSnapshotRange,
  getStockTradesInRange,
  getStockTransactions,
  getStocks,
  getTradingDays,
  ownerIdsForScope,
  parseScope,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * 往前多抓一段收盤價才找得到「前一日」。
 * 農曆年可能連休九天,加上前後週末,抓一個月最保險。
 */
const PRICE_LOOKBACK_DAYS = 30;

function shiftDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; scope?: string; day?: string }>;
}) {
  const params = await searchParams;
  const scope = parseScope(params.scope);

  const session = await getSession();
  if (!session) return null;

  const today = todayInTaipei();
  const month = parseMonth(params.month, today.slice(0, 7));
  const selectedDay = parseDay(params.day, month);
  const ownerIds = ownerIdsForScope(scope, session.userId, session.members);

  /*
   * 一次撈整年,月曆與上方的 12 個月列都從同一份結果切出來 ——
   * 月合計是當月每一格的加總,兩邊用同一份資料才保證對得上。
   *
   * 月曆只排平日,所以盈虧也只算平日。
   * 週一的前一天是週日,而週日的快照沿用週五的價格,所以跨週末仍然算得對。
   */
  const year = month.slice(0, 4);
  const yearMonths = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const yearDays = yearMonths.flatMap((m) => weekdaysInMonth(m));
  const first = `${year}-01-01`;
  const last = `${year}-12-31`;

  const [snapshots, trades, tradingDays, holidays] = await Promise.all([
    // 多要前一天,才算得出 1/1 的盈虧
    getSnapshotRange(scope, session.userId, previousDay(first), last),
    getStockTradesInRange(ownerIds, first, last),
    getTradingDays(first, last),
    getHolidays(first, last),
  ]);

  // 盈虧看的是股票市值,不是總資產 —— 詳見 lib/pnl.ts 的說明
  const stockByDate = new Map(snapshots.map((s) => [s.snapshot_date, Number(s.stock_twd)]));

  const yearRows = computeDailyPnl(
    stockByDate,
    groupTradesByDate(trades),
    yearDays,
    tradingDays,
    new Set(holidays.keys())
  );
  const byDate = new Map<string, DailyPnl>(
    yearRows.filter((r) => r.date.startsWith(month)).map((r) => [r.date, r])
  );
  const months = summarizeMonths(yearRows);

  // 選了某一天才去撈明細要用的資料
  let detail = null;
  if (selectedDay) {
    const [allTxns, prices, stocks] = await Promise.all([
      getStockTransactions(ownerIds),
      getPricesInRange(shiftDays(selectedDay, -PRICE_LOOKBACK_DAYS), selectedDay),
      getStocks(),
    ]);

    const holdings = computeHoldingPnl(allTxns, selectedDay, buildPriceLookup(prices));
    const row = byDate.get(selectedDay);

    detail = {
      date: selectedDay,
      rows: holdings,
      total: row?.pnl ?? null,
      hasInitial: (row?.trades?.initial ?? 0) > 0,
      names: new Map(stocks.filter((st) => st.name).map((st) => [st.symbol, st.name as string])),
    };
  }

  return (
    <div className="pb-2">
      <div className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">每日盈虧</h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          扣掉買賣後的純市值變化
        </p>
      </div>

      <Suspense fallback={<div className="mb-4 h-9" />}>
        <FilterBar scope={scope} showScopeToggle={session.members.length > 1} showRange={false} />
      </Suspense>

      <MonthStrip
        year={year}
        months={months}
        selectedMonth={month}
        today={today}
        scope={scope}
      />

      <PnlCalendar
        month={month}
        weeks={monthGrid(month)}
        byDate={byDate}
        today={today}
        scope={scope}
        total={months.get(month) ?? monthTotal([])}
        selectedDay={selectedDay}
        holidays={holidays}
      />

      {detail && (
        <div id="day-detail">
          <DayDetail
            date={detail.date}
            rows={detail.rows}
            total={detail.total}
            hasInitial={detail.hasInitial}
            names={detail.names}
          />
        </div>
      )}
    </div>
  );
}
