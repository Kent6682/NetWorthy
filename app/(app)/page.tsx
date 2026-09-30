import { Suspense } from 'react';
import DonutChart from '@/components/DonutChart';
import TrendChart from '@/components/TrendChart';
import YearlyPnl from '@/components/YearlyPnl';
import FilterBar from '@/components/FilterBar';
import { formatMoney, formatPercent, todayInTaipei } from '@/lib/format';
import {
  buildAssetSlices,
  buildValuedHoldings,
  computeRealizedTwd,
  computeTotals,
  parseRange,
  pickLastTradingDays,
  rangeStartDate,
  RANGE_OPTIONS,
} from '@/lib/portfolio';
import {
  getAccountBalances,
  getLatestPrices,
  getMarketDataNear,
  getSession,
  getSnapshots,
  getStocks,
  getStockTransactions,
  getTradingDays,
  getUsdToTwd,
  ownerIdsForScope,
  parseScope,
} from '@/lib/queries';
import { buildPriceLookup } from '@/lib/pnl';
import { computeYearly, sumYears, yearBoundaries } from '@/lib/yearly';

export const dynamic = 'force-dynamic';

/** 統計方塊 — 手機 2×2,桌機 4 欄 */
/** 帶正負號的金額:+241,904 / −364,785 */
function signedMoney(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded).toLocaleString('en-US')}`;
}

/** 損益的顏色:賺紅、賠綠,剛好 0 不上色 —— 0 塗成紅色看起來像賺了錢 */
function toneOf(value: number): 'positive' | 'negative' | undefined {
  const rounded = Math.round(value);
  if (rounded > 0) return 'positive';
  if (rounded < 0) return 'negative';
  return undefined;
}

function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'positive' | 'negative';
}) {
  return (
    <div className="card px-3.5 py-3 sm:px-4">
      <div className="eyebrow truncate">{label}</div>
      <div
        className={`tnum mt-1 text-base font-semibold tracking-tight sm:text-lg ${
          tone === 'positive' ? 'pos' : tone === 'negative' ? 'neg' : ''
        }`}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-xs leading-snug" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; range?: string }>;
}) {
  const params = await searchParams;
  const scope = parseScope(params.scope);
  const rangeKey = parseRange(params.range);
  const rangeOption = RANGE_OPTIONS.find((r) => r.key === rangeKey)!;

  const session = await getSession();
  if (!session) return null;

  const ownerIds = ownerIdsForScope(scope, session.userId, session.members);
  const today = todayInTaipei();

  /*
   * 「1 日」比的是最近兩個交易日,不是日曆上的昨天與今天。
   *
   * 週一的前一天是週日,沒有開盤 —— 快照沿用週五的價格,拿來比會得到 0。
   * 哪幾天有開盤看 stock_price_history 有沒有收盤價,國定假日才判斷得出來,
   * 不能靠星期幾。
   */
  let since = rangeStartDate(rangeKey, today);
  let tradingDays: Set<string> | null = null;

  if (rangeKey === '1d') {
    tradingDays = await getTradingDays(rangeStartDate('1m', today), today);
    const lastTwo = pickLastTradingDays(tradingDays, today, 2);
    if (lastTwo.length === 2) since = lastTwo[0];
  }

  const [{ rate: usdToTwd, date: fxDate }, balances, transactions, stocks, prices, snapshots] =
    await Promise.all([
      getUsdToTwd(),
      getAccountBalances(ownerIds),
      getStockTransactions(ownerIds),
      getStocks(),
      getLatestPrices(),
      getSnapshots(scope, session.userId, since),
    ]);

  const holdings = buildValuedHoldings(transactions, stocks, prices, usdToTwd);
  const totals = computeTotals(
    holdings,
    balances,
    usdToTwd,
    computeRealizedTwd(transactions, stocks, usdToTwd)
  );
  const slices = buildAssetSlices(holdings, balances, usdToTwd);

  /*
   * 年度損益:每年當一段期間結算(期末 − 期初 − 買入 + 賣出),詳見 lib/yearly.ts。
   * 只需要每個年底附近的收盤價與匯率,不撈整段歷史。
   */
  const marketData = await getMarketDataNear(yearBoundaries(transactions, today));
  const fxLookup = buildPriceLookup(
    marketData.usdTwd.map((r) => ({ symbol: 'USD', price_date: r.date, close_price: r.rate }))
  );
  const currencyOf = new Map(stocks.map((st) => [st.symbol, st.currency]));
  const yearly = computeYearly({
    transactions,
    currencyOf: (symbol) => currencyOf.get(symbol) ?? 'TWD',
    priceOn: buildPriceLookup(marketData.prices),
    usdToTwdOn: (date) => fxLookup('USD', date) ?? usdToTwd,
    today,
  });
  const yearlyTotal = sumYears(yearly);
  const thisYear = yearly.find((r) => r.year === Number(today.slice(0, 4)));

  const hasUsdAssets =
    holdings.some((h) => h.currency === 'USD') || balances.some((b) => b.currency === 'USD');

  const unrealizedPercent =
    totals.stockTwd - totals.unrealizedPnLTwd !== 0
      ? (totals.unrealizedPnLTwd / (totals.stockTwd - totals.unrealizedPnLTwd)) * 100
      : 0;

  /*
   * 主數字是即時算出來的,趨勢圖卻是每日排程寫下的快照。
   * 排程還沒跑到今天之前,兩個數字會對不起來(尤其今天剛記了一筆大額進出時)。
   * 所以最後補上一個「今天」的即時點,讓曲線收在跟主數字相同的位置。
   */
  const withToday =
    snapshots.length > 0 && snapshots[snapshots.length - 1].snapshot_date < today
      ? [
          ...snapshots,
          {
            snapshot_date: today,
            cash_twd: totals.cashTwd,
            stock_twd: totals.stockTwd,
            total_twd: totals.totalTwd,
            owner_id: scope === 'family' ? null : session.userId,
          },
        ]
      : snapshots;

  /*
   * 「1 日」只留那兩個交易日。中間的週末與假日快照是沿用前一個交易日的價格
   * 算出來的,留著只會在圖上多出幾個持平的點。
   *
   * 排程還沒跑到今天時,今天不在交易日清單裡,會被濾掉 —— 那時候比的是
   * 最近一次真正收盤的變化,而不是拿還沒有報價的今天去比。
   */
  const trendData =
    rangeKey === '1d' && tradingDays
      ? withToday.filter((d) => tradingDays.has(d.snapshot_date)).slice(-2)
      : withToday;

  // 期間內的變化,放在主數字底下
  const periodChange =
    trendData.length > 1
      ? Number(trendData[trendData.length - 1].total_twd) - Number(trendData[0].total_twd)
      : 0;
  const periodPercent =
    trendData.length > 1 && Number(trendData[0].total_twd) !== 0
      ? (periodChange / Math.abs(Number(trendData[0].total_twd))) * 100
      : 0;

  return (
    <div>
      {/* 主數字 ---------------------------------------------------------- */}
      <div className="mb-5">
        <p className="eyebrow">{scope === 'family' ? '全家總資產' : '我的總資產'}</p>
        <p className="hero-figure mt-1">{formatMoney(totals.totalTwd)}</p>
        {trendData.length > 1 && (
          <div className="mt-2 flex items-center gap-2">
            <span className={`delta-chip ${periodChange >= 0 ? 'pos' : 'neg'}`}>
              {periodChange >= 0 ? '↑' : '↓'} {formatMoney(Math.abs(periodChange))}
            </span>
            <span className="tnum text-xs" style={{ color: 'var(--text-secondary)' }}>
              {formatPercent(periodPercent)} ・ {rangeOption.label}
            </span>
          </div>
        )}
      </div>

      {/* 篩選列:所有圖表共用同一組條件 --------------------------------- */}
      <Suspense fallback={<div className="mb-5 h-9" />}>
        <FilterBar scope={scope} range={rangeKey} showScopeToggle={session.members.length > 1} />
      </Suspense>

      {/* 統計 ------------------------------------------------------------ */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <StatTile
          label="股票市值"
          value={formatMoney(totals.stockTwd)}
          hint={`${holdings.length} 檔持股`}
        />
        <StatTile
          label="現金"
          value={formatMoney(totals.cashTwd)}
          hint={`${balances.filter((b) => !b.is_archived).length} 個帳戶`}
        />
        {/* 今年的兩個數字來自年度表;目前持股的帳面未實現放在小字當參考 */}
        <StatTile
          label="今年未實現損益"
          value={formatMoney(thisYear?.unrealized ?? 0)}
          hint={`持股帳面 ${formatMoney(totals.unrealizedPnLTwd)}(${formatPercent(unrealizedPercent)})`}
          tone={toneOf(thisYear?.unrealized ?? 0)}
        />
        <StatTile
          label="今年已實現損益"
          value={formatMoney(thisYear?.realized ?? 0)}
          hint={
            thisYear && Math.round(thisYear.dividends) !== 0
              ? `買賣 ${signedMoney(thisYear.tradingRealized)} ＋ 股利 ${signedMoney(thisYear.dividends)}`
              : `${today.slice(0, 4)} 年賣出結算`
          }
          tone={toneOf(thisYear?.realized ?? 0)}
        />
      </div>

      {/* 圖表 ------------------------------------------------------------ */}
      <div className="mt-4 space-y-4 sm:mt-5 sm:space-y-5">
        <TrendChart data={trendData} rangeLabel={rangeOption.label} />
        <DonutChart slices={slices} total={totals.totalTwd} />
        <YearlyPnl rows={yearly} total={yearlyTotal} today={today} />
      </div>

      {hasUsdAssets && (
        <p className="mt-4 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {fxDate
            ? `美元資產以 ${fxDate} 的匯率 1 USD = ${usdToTwd.toFixed(3)} TWD 換算`
            : '尚未同步到匯率資料,美元資產目前以 1:1 計入總資產,數字會失真 — 請先讓每日同步排程跑過一次'}
        </p>
      )}
    </div>
  );
}
