import { formatDate, formatMoney, formatPercent, formatPrice, formatShares } from '@/lib/format';
import { STOCK_TXN_LABEL } from '@/lib/types';
import type { HoldingPnl } from '@/lib/pnl';

/**
 * 日曆點開後的單日明細:每檔跟前一日比的盈虧。
 *
 * 加總會精確等於日曆格子的數字 —— 兩邊用同一套估價規則,詳見 lib/pnl.ts。
 * 手機用卡片列、桌機用完整表格,沿用 app 既有的響應式慣例。
 */

function PriceMove({ row }: { row: HoldingPnl }) {
  return (
    <span className="tnum">
      {formatPrice(row.prevPrice)} → {formatPrice(row.price)}
    </span>
  );
}

function Pnl({ value }: { value: number | null }) {
  if (value === null) return <span style={{ color: 'var(--text-muted)' }}>導入</span>;
  return (
    <span className={`tnum ${value >= 0 ? 'pos' : 'neg'}`}>
      {value >= 0 ? '+' : ''}
      {formatMoney(value)}
    </span>
  );
}

/** 盈虧佔前一日市值的比率;當天才建立的部位沒有基準 */
function Percent({ value }: { value: number | null }) {
  if (value === null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return <span className={`tnum ${value >= 0 ? 'pos' : 'neg'}`}>{formatPercent(value)}</span>;
}

export default function DayDetail({
  date,
  rows,
  total,
  hasInitial,
}: {
  date: string;
  rows: HoldingPnl[];
  total: number | null;
  hasInitial: boolean;
}) {
  return (
    <section className="card-flush mt-5 overflow-hidden">
      <div className="flex items-baseline justify-between gap-4 px-4 py-3 sm:px-5">
        <div>
          <h2 className="section-title">{formatDate(date)}</h2>
          <p className="eyebrow mt-0.5">
            {hasInitial ? '導入既有持股,當天不計盈虧' : `${rows.length} 檔持股`}
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
            {rows.map((row) => (
              <div key={row.symbol} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium">{row.symbol}</span>
                  <span className="flex shrink-0 items-baseline gap-2 text-sm">
                    <Percent value={row.percent} />
                    <Pnl value={row.pnl} />
                  </span>
                </div>
                <div
                  className="mt-1 flex items-baseline justify-between gap-3 text-xs"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <span className="tnum">{formatShares(row.shares)} 股</span>
                  <PriceMove row={row} />
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
            ))}
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
                {rows.map((row) => (
                  <tr key={row.symbol} style={{ borderTop: '1px solid var(--divider)' }}>
                    <td className="px-5 py-2.5">
                      <span className="font-medium">{row.symbol}</span>
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
                    <td className="px-3 py-2.5 text-right" style={{ color: 'var(--text-secondary)' }}>
                      {formatPrice(row.prevPrice)}
                    </td>
                    <td className="px-3 py-2.5 text-right">{formatPrice(row.price)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Percent value={row.percent} />
                    </td>
                    <td className="px-5 py-2.5 text-right font-medium">
                      <Pnl value={row.pnl} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
