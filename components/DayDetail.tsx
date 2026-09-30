import { formatDate, formatMoney, formatPercent, formatPrice, formatShares } from '@/lib/format';
import { STOCK_TXN_LABEL } from '@/lib/types';
import type { HoldingPnl } from '@/lib/pnl';

/**
 * 日曆點開後的單日明細:每檔跟前一日比的盈虧。
 *
 * 加總會精確等於日曆格子的數字 —— 兩邊用同一套估價規則,詳見 lib/pnl.ts。
 * 手機用卡片列、桌機用完整表格,沿用 app 既有的響應式慣例。
 *
 * 有開盤的日子,某一檔「當日收盤」其實是沿用前一個交易日的價格時(還沒同步到),
 * 那一列標「未更新」、不給盈虧 —— 沿用的價格算出來的 0 看起來跟「今天持平」一模一樣。
 */

/** 這一列的當日收盤是不是還沒更新(沿用舊價格,或完全沒有報價) */
function isStale(row: HoldingPnl, date: string, tradingDay: boolean): boolean {
  return tradingDay && row.priceDate !== date;
}

/** 9/24 這種短日期,給「沿用哪一天」用 */
function shortDate(value: string): string {
  const [, m, d] = value.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function StaleNote({ row }: { row: HoldingPnl }) {
  return (
    <span style={{ color: 'var(--text-muted)' }}>
      未更新 · {row.priceDate ? `沿用 ${shortDate(row.priceDate)} 收盤` : '沒有報價'}
    </span>
  );
}

function PriceMove({ row }: { row: HoldingPnl }) {
  return (
    <span className="tnum">
      {formatPrice(row.prevPrice)} → {formatPrice(row.price)}
    </span>
  );
}

function Pnl({ value, stale }: { value: number | null; stale: boolean }) {
  if (stale) return <span style={{ color: 'var(--text-muted)' }}>待更新</span>;
  if (value === null) return <span style={{ color: 'var(--text-muted)' }}>導入</span>;
  return (
    <span className={`tnum ${value >= 0 ? 'pos' : 'neg'}`}>
      {value >= 0 ? '+' : ''}
      {formatMoney(value)}
    </span>
  );
}

/** 盈虧佔前一日市值的比率;當天才建立的部位沒有基準 */
function Percent({ value, stale }: { value: number | null; stale: boolean }) {
  if (value === null || stale) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return <span className={`tnum ${value >= 0 ? 'pos' : 'neg'}`}>{formatPercent(value)}</span>;
}

export default function DayDetail({
  date,
  rows,
  total,
  hasInitial,
  tradingDay,
  pending,
  names,
}: {
  date: string;
  rows: HoldingPnl[];
  total: number | null;
  hasInitial: boolean;
  /** 那天有開盤。沒開盤的日子每檔都沿用前一日,那是正常的,不標未更新 */
  tradingDay: boolean;
  /** 那天的收盤價還沒到齊,格子上顯示「待更新」 */
  pending: boolean;
  /** 代號 → 商品名稱;沒有名稱的只顯示代號 */
  names: Map<string, string>;
}) {
  const staleCount = rows.filter((r) => isStale(r, date, tradingDay)).length;

  return (
    <section className="card-flush mt-5 overflow-hidden">
      <div className="flex items-baseline justify-between gap-4 px-4 py-3 sm:px-5">
        <div>
          <h2 className="section-title">{formatDate(date)}</h2>
          <p className="eyebrow mt-0.5">
            {hasInitial
              ? '導入既有持股,當天不計盈虧'
              : staleCount > 0
                ? `${rows.length} 檔持股,其中 ${staleCount} 檔還沒拿到這天的收盤價,下一次同步會補上`
                : pending
                  ? `${rows.length} 檔持股,這天的收盤價還沒到齊,下一次同步會補上`
                  : `${rows.length} 檔持股`}
          </p>
        </div>
        {total !== null && (
          <span className={`tnum text-base font-semibold ${total >= 0 ? 'pos' : 'neg'}`}>
            {total >= 0 ? '+' : ''}
            {formatMoney(total)}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-sm sm:px-5" style={{ color: 'var(--text-muted)' }}>
          這天沒有任何持股。
        </p>
      ) : (
        <>
          {/* 手機:卡片列 */}
          <div
            className="divide-hairline md:hidden"
            style={{ borderTop: '1px solid var(--divider)' }}
          >
            {rows.map((row) => {
              const stale = isStale(row, date, tradingDay);
              return (
                <div key={row.symbol} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    {/* 手機:名稱正常字、代號小一號灰字;放不下時截名稱,代號留著 */}
                    <span className="flex min-w-0 items-baseline gap-1.5 text-sm">
                      {names.get(row.symbol) ? (
                        <>
                          <span className="truncate font-medium">{names.get(row.symbol)}</span>
                          <span
                            className="tnum shrink-0 text-xs"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {row.symbol}
                          </span>
                        </>
                      ) : (
                        <span className="truncate font-medium">{row.symbol}</span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-baseline gap-2 text-sm">
                      <Percent value={row.percent} stale={stale} />
                      <Pnl value={row.pnl} stale={stale} />
                    </span>
                  </div>
                  <div
                    className="mt-1 flex items-baseline justify-between gap-3 text-xs"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <span className="tnum">{formatShares(row.shares)} 股</span>
                    {stale ? <StaleNote row={row} /> : <PriceMove row={row} />}
                  </div>
                  {row.trades.length > 0 && (
                    <div className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {row.trades.map((t, i) => (
                        <div key={i} className="tnum">
                          {STOCK_TXN_LABEL[t.type]} {formatShares(t.shares)} 股 @{' '}
                          {formatPrice(t.price)}
                          {t.fee > 0 && `,費用 ${formatMoney(t.fee)}`}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 桌機:完整表格 */}
          <div className="hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="eyebrow">
                  <th className="px-5 py-2 text-left font-normal">標的</th>
                  <th className="px-3 py-2 text-right font-normal">股數</th>
                  <th className="px-3 py-2 text-right font-normal">前日收盤</th>
                  <th className="px-3 py-2 text-right font-normal">當日收盤</th>
                  <th className="px-3 py-2 text-right font-normal">漲跌幅</th>
                  <th className="px-5 py-2 text-right font-normal">盈虧</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {rows.map((row) => {
                  const stale = isStale(row, date, tradingDay);
                  return (
                    <tr key={row.symbol} style={{ borderTop: '1px solid var(--divider)' }}>
                      <td className="px-5 py-2.5">
                        {/* 跟手機一樣:名稱正常字、代號小一號灰字 */}
                        <span className="font-medium">{names.get(row.symbol) ?? row.symbol}</span>
                        {names.get(row.symbol) && (
                          <span className="ml-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                            {row.symbol}
                          </span>
                        )}
                        {row.trades.map((t, i) => (
                          <span
                            key={i}
                            className="ml-2 text-xs"
                            style={{ color: 'var(--text-secondary)' }}
                          >
                            {STOCK_TXN_LABEL[t.type]} {formatShares(t.shares)} @{' '}
                            {formatPrice(t.price)}
                            {t.fee > 0 && `(費用 ${formatMoney(t.fee)})`}
                          </span>
                        ))}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {formatShares(row.shares)}
                        {row.prevShares !== row.shares && (
                          <span className="ml-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                            (前 {formatShares(row.prevShares)})
                          </span>
                        )}
                      </td>
                      <td
                        className="px-3 py-2.5 text-right"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {formatPrice(row.prevPrice)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {stale ? (
                          <span className="text-xs">
                            <StaleNote row={row} />
                          </span>
                        ) : (
                          formatPrice(row.price)
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Percent value={row.percent} stale={stale} />
                      </td>
                      <td className="px-5 py-2.5 text-right font-medium">
                        <Pnl value={row.pnl} stale={stale} />
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
  );
}
