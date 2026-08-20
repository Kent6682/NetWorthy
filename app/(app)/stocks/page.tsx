import { Suspense } from 'react';
import FilterBar from '@/components/FilterBar';
import StockTransactionForm from '@/components/StockTransactionForm';
import { EmptyState, ListRow, SectionHeader } from '@/components/ListRow';
import { deleteStockTransaction } from '@/app/actions/stocks';
import { formatDate, formatMoney, formatPercent, formatPrice, formatShares } from '@/lib/format';
import { buildValuedHoldings, toTwd } from '@/lib/portfolio';
import {
  getAccountBalances,
  getLatestPrices,
  getSession,
  getStocks,
  getStockTransactions,
  getUsdToTwd,
  ownerIdsForScope,
  parseScope,
} from '@/lib/queries';
import { STOCK_TXN_LABEL } from '@/lib/types';

export const dynamic = 'force-dynamic';

function DeleteButton({ id }: { id: string }) {
  return (
    <form action={deleteStockTransaction}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="text-xs underline underline-offset-2"
        style={{ color: 'var(--text-muted)' }}
      >
        刪除
      </button>
    </form>
  );
}

export default async function StocksPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const params = await searchParams;
  const scope = parseScope(params.scope);

  const session = await getSession();
  if (!session) return null;

  const ownerIds = ownerIdsForScope(scope, session.userId, session.members);
  const memberNames = new Map(session.members.map((m) => [m.id, m.display_name]));

  const [{ rate: usdToTwd }, transactions, stocks, prices, balances] = await Promise.all([
    getUsdToTwd(),
    getStockTransactions(ownerIds),
    getStocks(),
    getLatestPrices(),
    getAccountBalances([session.userId]),
  ]);

  const holdings = buildValuedHoldings(transactions, stocks, prices, usdToTwd);
  const brokerAccounts = balances.filter((b) => b.type === 'broker_cash' && !b.is_archived);
  const stockMap = new Map(stocks.map((s) => [s.symbol, s]));

  const totalMarketValue = holdings.reduce((sum, h) => sum + h.marketValueTwd, 0);
  // 合計一定要換算成台幣再相加 — 台股與美股的損益不同幣別,直接加會得出無意義的數字
  const totalPnLTwd = holdings.reduce(
    (sum, h) => sum + toTwd(h.unrealizedPnL, h.currency, usdToTwd),
    0
  );
  const showOwner = scope === 'family';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">股票</h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
            持股市值 <span className="tnum">{formatMoney(totalMarketValue)}</span>
          </p>
        </div>
        <StockTransactionForm brokerAccounts={brokerAccounts} />
      </div>

      <Suspense fallback={<div className="mb-4 h-9" />}>
        <FilterBar scope={scope} showScopeToggle={session.members.length > 1} showRange={false} />
      </Suspense>

      {/* 目前持股 ------------------------------------------------------- */}
      <section className="card-flush overflow-hidden">
        <SectionHeader
          title="目前持股"
          trailing={
            holdings.length > 0 ? (
              <span className={`tnum text-sm font-medium ${totalPnLTwd >= 0 ? 'pos' : 'neg'}`}>
                {totalPnLTwd >= 0 ? '+' : ''}
                {formatMoney(totalPnLTwd)}
              </span>
            ) : undefined
          }
        />

        {holdings.length === 0 ? (
          <EmptyState>
            還沒有持股。用上方的「新增交易」選「期初持股」,把手上現有的股票輸入進來。
          </EmptyState>
        ) : (
          <>
            {/* 手機:卡片列 */}
            <div className="divide-hairline mt-3 md:hidden" style={{ borderTop: '1px solid var(--divider)' }}>
              {holdings.map((h) => (
                <ListRow
                  key={`${h.ownerId}-${h.symbol}`}
                  title={
                    <>
                      {h.symbol}
                      <span className="ml-2 font-normal" style={{ color: 'var(--text-secondary)' }}>
                        {h.name ?? (h.market === 'TW' ? '台股' : '美股')}
                      </span>
                    </>
                  }
                  subtitle={
                    <>
                      {formatShares(h.shares)} 股 ・ 均價 {formatPrice(h.avgCost)}
                      {showOwner && ` ・ ${memberNames.get(h.ownerId) ?? ''}`}
                    </>
                  }
                  value={formatMoney(h.marketValue, h.currency)}
                  subValue={
                    <span className={h.unrealizedPnL >= 0 ? 'pos' : 'neg'}>
                      {h.unrealizedPnL >= 0 ? '+' : ''}
                      {formatMoney(h.unrealizedPnL, h.currency)} ({formatPercent(h.unrealizedPnLPercent)})
                    </span>
                  }
                  meta={
                    h.lastPrice === null ? (
                      <span>報價未同步,市值暫以成本價估算</span>
                    ) : (
                      <span>現價 {formatPrice(h.lastPrice)}</span>
                    )
                  }
                />
              ))}
            </div>

            {/* 桌機:完整表格 */}
            <div className="mt-3 hidden md:block">
              <table className="w-full text-sm tnum">
                <thead>
                  <tr className="eyebrow">
                    <th className="px-5 py-2 text-left font-normal">代號</th>
                    {showOwner && <th className="px-3 py-2 text-left font-normal">持有人</th>}
                    <th className="px-3 py-2 text-right font-normal">股數</th>
                    <th className="px-3 py-2 text-right font-normal">均價</th>
                    <th className="px-3 py-2 text-right font-normal">現價</th>
                    <th className="px-3 py-2 text-right font-normal">市值</th>
                    <th className="px-5 py-2 text-right font-normal">未實現損益</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h) => (
                    <tr
                      key={`${h.ownerId}-${h.symbol}`}
                      style={{ borderTop: '1px solid var(--divider)' }}
                    >
                      <td className="px-5 py-2.5">
                        <div className="font-medium">{h.symbol}</div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {h.name ?? (h.market === 'TW' ? '台股' : '美股')}
                        </div>
                      </td>
                      {showOwner && (
                        <td className="px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>
                          {memberNames.get(h.ownerId) ?? '—'}
                        </td>
                      )}
                      <td className="px-3 py-2.5 text-right">{formatShares(h.shares)}</td>
                      <td className="px-3 py-2.5 text-right">{formatPrice(h.avgCost)}</td>
                      <td className="px-3 py-2.5 text-right">
                        {h.lastPrice === null ? (
                          <span
                            style={{ color: 'var(--text-muted)' }}
                            title="尚未同步到報價,市值暫以成本價估算"
                          >
                            未同步
                          </span>
                        ) : (
                          formatPrice(h.lastPrice)
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {formatMoney(h.marketValue, h.currency)}
                      </td>
                      <td
                        className={`px-5 py-2.5 text-right ${h.unrealizedPnL >= 0 ? 'pos' : 'neg'}`}
                      >
                        {h.unrealizedPnL >= 0 ? '+' : ''}
                        {formatMoney(h.unrealizedPnL, h.currency)}
                        <div className="text-xs">{formatPercent(h.unrealizedPnLPercent)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* 交易紀錄 ------------------------------------------------------- */}
      <section className="card-flush mt-4 overflow-hidden sm:mt-5">
        <SectionHeader title="交易紀錄" hint={`共 ${transactions.length} 筆`} />

        {transactions.length === 0 ? (
          <EmptyState>還沒有任何交易紀錄。</EmptyState>
        ) : (
          <>
            {/* 手機 */}
            <div className="divide-hairline mt-3 md:hidden" style={{ borderTop: '1px solid var(--divider)' }}>
              {transactions.map((t) => {
                const currency = stockMap.get(t.symbol)?.currency ?? 'TWD';
                const isMine = t.owner_id === session.userId;
                return (
                  <ListRow
                    key={t.id}
                    title={
                      <>
                        <span
                          style={{
                            color:
                              t.type === 'buy'
                                ? 'var(--series-1)'
                                : t.type === 'sell'
                                  ? 'var(--series-2)'
                                  : 'var(--text-secondary)',
                          }}
                        >
                          {STOCK_TXN_LABEL[t.type]}
                        </span>
                        <span className="ml-2">{t.symbol}</span>
                      </>
                    }
                    subtitle={`${formatShares(t.shares)} 股 × ${formatPrice(t.price)}${t.fee > 0 ? ` ・ 費用 ${formatPrice(t.fee)}` : ''}`}
                    value={formatMoney(t.shares * t.price, currency)}
                    meta={
                      <>
                        {formatDate(t.transaction_date)}
                        {showOwner && ` ・ ${memberNames.get(t.owner_id) ?? ''}`}
                      </>
                    }
                    action={isMine ? <DeleteButton id={t.id} /> : undefined}
                  />
                );
              })}
            </div>

            {/* 桌機 */}
            <div className="mt-3 hidden md:block">
              <table className="w-full text-sm tnum">
                <thead>
                  <tr className="eyebrow">
                    <th className="px-5 py-2 text-left font-normal">日期</th>
                    <th className="px-3 py-2 text-left font-normal">類型</th>
                    <th className="px-3 py-2 text-left font-normal">代號</th>
                    {showOwner && <th className="px-3 py-2 text-left font-normal">持有人</th>}
                    <th className="px-3 py-2 text-right font-normal">股數</th>
                    <th className="px-3 py-2 text-right font-normal">價格</th>
                    <th className="px-3 py-2 text-right font-normal">手續費</th>
                    <th className="px-3 py-2 text-right font-normal">金額</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => {
                    const currency = stockMap.get(t.symbol)?.currency ?? 'TWD';
                    const isMine = t.owner_id === session.userId;
                    return (
                      <tr key={t.id} style={{ borderTop: '1px solid var(--divider)' }}>
                        <td className="px-5 py-2.5">{formatDate(t.transaction_date)}</td>
                        <td className="px-3 py-2.5">
                          <span
                            style={{
                              color:
                                t.type === 'buy'
                                  ? 'var(--series-1)'
                                  : t.type === 'sell'
                                    ? 'var(--series-2)'
                                    : 'var(--text-secondary)',
                            }}
                          >
                            {STOCK_TXN_LABEL[t.type]}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-medium">{t.symbol}</td>
                        {showOwner && (
                          <td className="px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>
                            {memberNames.get(t.owner_id) ?? '—'}
                          </td>
                        )}
                        <td className="px-3 py-2.5 text-right">{formatShares(t.shares)}</td>
                        <td className="px-3 py-2.5 text-right">{formatPrice(t.price)}</td>
                        <td
                          className="px-3 py-2.5 text-right"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {t.fee > 0 ? formatPrice(t.fee) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {formatMoney(t.shares * t.price, currency)}
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          {isMine && <DeleteButton id={t.id} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <p className="mt-4 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        均價採移動加權平均法:買進時把成本與手續費併入重算,賣出時均價不變、只按均價把成本移出。
        刪除一筆買賣時,它連動產生的券商帳戶收支也會一併移除。
      </p>
    </div>
  );
}
