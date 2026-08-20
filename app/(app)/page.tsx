import { Suspense } from 'react';
import DonutChart from '@/components/DonutChart';
import TrendChart from '@/components/TrendChart';
import FilterBar from '@/components/FilterBar';
import { formatMoney, formatPercent, todayInTaipei } from '@/lib/format';
import {
  buildAssetSlices,
  buildValuedHoldings,
  computeTotals,
  RANGE_OPTIONS,
  type RangeKey,
} from '@/lib/portfolio';
import {
  getAccountBalances,
  getLatestPrices,
  getSession,
  getSnapshots,
  getStocks,
  getStockTransactions,
  getUsdToTwd,
  ownerIdsForScope,
  parseScope,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';

/** 統計方塊 — 手機 2×2,桌機 4 欄 */
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
        <div className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-muted)' }}>
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
  const rangeKey = (RANGE_OPTIONS.find((r) => r.key === params.range)?.key ?? '6m') as RangeKey;
  const rangeOption = RANGE_OPTIONS.find((r) => r.key === rangeKey)!;

  const session = await getSession();
  if (!session) return null;

  const ownerIds = ownerIdsForScope(scope, session.userId, session.members);

  const [{ rate: usdToTwd, date: fxDate }, balances, transactions, stocks, prices, snapshots] =
    await Promise.all([
      getUsdToTwd(),
      getAccountBalances(ownerIds),
      getStockTransactions(ownerIds),
      getStocks(),
      getLatestPrices(),
      getSnapshots(scope, session.userId, rangeOption.months),
    ]);

  const holdings = buildValuedHoldings(transactions, stocks, prices, usdToTwd);
  const totals = computeTotals(holdings, balances, usdToTwd);
  const slices = buildAssetSlices(holdings, balances, usdToTwd);

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
  const today = todayInTaipei();
  const trendData =
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
        <StatTile
          label="未實現損益"
          value={formatMoney(totals.unrealizedPnLTwd)}
          hint={formatPercent(unrealizedPercent)}
          tone={totals.unrealizedPnLTwd >= 0 ? 'positive' : 'negative'}
        />
        <StatTile
          label="已實現損益"
          value={formatMoney(totals.realizedPnLTwd)}
          hint="累計賣出結算"
          tone={totals.realizedPnLTwd >= 0 ? 'positive' : 'negative'}
        />
      </div>

      {/* 圖表 ------------------------------------------------------------ */}
      <div className="mt-4 space-y-4 sm:mt-5 sm:space-y-5">
        <TrendChart data={trendData} rangeLabel={rangeOption.label} />
        <DonutChart slices={slices} total={totals.totalTwd} />
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
