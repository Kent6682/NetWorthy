import { Suspense } from 'react';
import DayDetail from '@/components/DayDetail';
import FilterBar from '@/components/FilterBar';
import PnlCalendar from '@/components/PnlCalendar';
import { todayInTaipei } from '@/lib/format';
import {
  buildPriceLookup,
  computeDailyPnl,
  computeHoldingPnl,
  daysInMonth,
  groupTradesByDate,
  monthGrid,
  monthTotal,
  parseDay,
  parseMonth,
  previousDay,
  weekdaysInMonth,
  type DailyPnl,
} from '@/lib/pnl';
import {
  getPricesInRange,
  getSession,
  getSnapshotRange,
  getStockTradesInRange,
  getStockTransactions,
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

  // 月曆只排平日,所以盈虧也只算平日。
  // 週一的前一天是週日,而週日的快照沿用週五的價格,所以跨週末仍然算得對。
  const days = weekdaysInMonth(month);
  const monthDays = daysInMonth(month);
  const first = monthDays[0];
  const last = monthDays[monthDays.length - 1];

  const [snapshots, trades, tradingDays] = await Promise.all([
    // 多要前一天,才算得出當月第一天的盈虧
    getSnapshotRange(scope, session.userId, previousDay(first), last),
    getStockTradesInRange(ownerIds, first, last),
    getTradingDays(first, last),
  ]);

  // 盈虧看的是股票市值,不是總資產 —— 詳見 lib/pnl.ts 的說明
  const stockByDate = new Map(snapshots.map((s) => [s.snapshot_date, Number(s.stock_twd)]));

  const rows = computeDailyPnl(stockByDate, groupTradesByDate(trades), days, tradingDays);
  const byDate = new Map<string, DailyPnl>(rows.map((r) => [r.date, r]));

  // 選了某一天才去撈明細要用的資料
  let detail = null;
  if (selectedDay) {
    const [allTxns, prices] = await Promise.all([
      getStockTransactions(ownerIds),
      getPricesInRange(shiftDays(selectedDay, -PRICE_LOOKBACK_DAYS), selectedDay),
    ]);

    const holdings = computeHoldingPnl(allTxns, selectedDay, buildPriceLookup(prices));
    const row = byDate.get(selectedDay);

    detail = {
      date: selectedDay,
      rows: holdings,
      total: row?.pnl ?? null,
      hasInitial: (row?.trades?.initial ?? 0) > 0,
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

      <PnlCalendar
        month={month}
        weeks={monthGrid(month)}
        byDate={byDate}
        today={today}
        scope={scope}
        total={monthTotal(rows)}
        selectedDay={selectedDay}
      />

      {detail && (
        <div id="day-detail">
          <DayDetail
            date={detail.date}
            rows={detail.rows}
            total={detail.total}
            hasInitial={detail.hasInitial}
          />
        </div>
      )}
    </div>
  );
}
