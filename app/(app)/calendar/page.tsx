import { Suspense } from 'react';
import DayDetail from '@/components/DayDetail';
import FilterBar from '@/components/FilterBar';
import MonthStrip from '@/components/MonthStrip';
import PnlCalendar from '@/components/PnlCalendar';
import { todayInTaipei } from '@/lib/format';
import {
  buildDatedPriceLookup,
  buildPriceLookup,
  computeDailyPnl,
  computeHoldingPnl,
  daysInMonth,
  groupTradesByDate,
  incompleteDays,
  monthGrid,
  monthTotal,
  parseDay,
  parseMonth,
  previousDay,
  stockValueByDate,
  summarizeMonths,
  weekdaysInMonth,
  type DailyPnl,
} from '@/lib/pnl';
import {
  getHolidays,
  getPricesInRange,
  getSession,
  getStockTradesInRange,
  getStockTransactions,
  getStocks,
  getTradingDays,
  getUsdToTwd,
  getUsdTwdHistory,
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

  const [fxRows, { rate: latestUsdTwd }, trades, tradingDays, holidays, allTxns, prices, stocks] =
    await Promise.all([
    getUsdTwdHistory(shiftDays(first, -PRICE_LOOKBACK_DAYS), last),
    getUsdToTwd(),
    getStockTradesInRange(ownerIds, first, last),
    getTradingDays(first, last),
    getHolidays(first, last),
    getStockTransactions(ownerIds),
    // 整年的收盤價:檢查每天的價格齊不齊,也給單日明細查前一日(往前多抓一個月涵蓋連假)
    getPricesInRange(shiftDays(first, -PRICE_LOOKBACK_DAYS), last),
    getStocks(),
  ]);

  /*
   * 每天的股票市值**即時算**,不讀每日快照。
   *
   * 快照是同步那一刻算的,補記、編輯、刪除過去的交易後要等下一次同步才會更新,
   * 這段期間格子會跟即時算的單日明細對不起來。即時算的話兩邊永遠一致。
   * 盈虧看的是股票市值,不是總資產 —— 詳見 lib/pnl.ts 的說明。
   */
  const priceOn = buildPriceLookup(prices);
  const fxOn = buildPriceLookup(fxRows.map((r) => ({ symbol: 'USD', price_date: r.date, close_price: r.rate })));
  const usdSymbols = new Set(stocks.filter((st) => st.currency === 'USD').map((st) => st.symbol));
  // 每個日曆天都要有值:星期一的「前一天」是星期日。
  // 多算前一天才算得出 1/1 的盈虧;今天以後還沒發生,不算。
  const valueDays = [previousDay(first), ...yearMonths.flatMap((m) => daysInMonth(m))].filter(
    (d) => d <= today
  );
  const stockByDate = stockValueByDate(
    allTxns,
    valueDays,
    priceOn,
    (symbol) => usdSymbols.has(symbol),
    (date) => fxOn('USD', date) ?? latestUsdTwd
  );

  /*
   * 有開盤、但持有中的台股有任何一檔還沒拿到當天收盤價的日子,快照是用部分舊價格
   * 算出來的 —— 數字看起來正常卻是錯的。這些日子一律標「待更新」,不給數字。
   */
  const priced = new Set(prices.map((p) => `${p.symbol}|${p.price_date}`));
  const marketOf = new Map(stocks.map((st) => [st.symbol, st.market]));
  const incomplete = incompleteDays(
    allTxns,
    tradingDays,
    (symbol, date) => priced.has(`${symbol}|${date}`),
    (symbol) => (marketOf.get(symbol) ?? 'TW') === 'TW'
  );

  const yearRows = computeDailyPnl(
    stockByDate,
    groupTradesByDate(trades),
    yearDays,
    tradingDays,
    new Set(holidays.keys()),
    incomplete
  );
  const byDate = new Map<string, DailyPnl>(
    yearRows.filter((r) => r.date.startsWith(month)).map((r) => [r.date, r])
  );
  const months = summarizeMonths(yearRows);

  let detail = null;
  if (selectedDay) {
    const lookup = buildDatedPriceLookup(prices);
    const holdings = computeHoldingPnl(
      allTxns,
      selectedDay,
      (symbol, date) => lookup(symbol, date)?.price ?? null,
      (symbol, date) => lookup(symbol, date)?.date ?? null
    );
    const row = byDate.get(selectedDay);

    detail = {
      date: selectedDay,
      rows: holdings,
      total: row?.pnl ?? null,
      hasInitial: (row?.trades?.initial ?? 0) > 0,
      // 沒開盤的日子每檔都「沿用前一日」,那是正常的,不該標成未更新
      tradingDay: tradingDays.has(selectedDay) || (row?.pending ?? false),
      pending: row?.pending ?? false,
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
            tradingDay={detail.tradingDay}
            pending={detail.pending}
            names={detail.names}
          />
        </div>
      )}
    </div>
  );
}
