import StockTransactionForm from '@/components/StockTransactionForm';
import { SectionHeader } from '@/components/ListRow';
import { dismissDividendSuggestion } from '@/app/actions/stocks';
import { formatDate, formatNumber, formatShares } from '@/lib/format';
import type { DividendSuggestion } from '@/lib/dividends';
import type { AccountBalance } from '@/lib/types';

/**
 * 股票頁上方的「待確認配息」。
 *
 * 資料來自交易所的除權息預告表(每日同步寫進 corporate_actions),
 * 金額 = 每股配息 × 除息日前一天收盤時的持股。按「記錄」打開已經填好的表單,
 * 核對後存檔;按「略過」就不再出現(例如已經用別的日期手動記過)。
 */
export default function DividendSuggestions({
  suggestions,
  names,
  brokerAccounts,
}: {
  suggestions: DividendSuggestion[];
  names: Map<string, string>;
  brokerAccounts: AccountBalance[];
}) {
  if (suggestions.length === 0) return null;

  return (
    <section className="card-flush mb-4 overflow-hidden sm:mb-5">
      <SectionHeader title="待確認的配息" hint={`${suggestions.length} 筆`} />
      <p className="px-4 text-xs leading-relaxed sm:px-5" style={{ color: 'var(--text-muted)' }}>
        依交易所公告的每股配息 × 你在除息日前一天的持股估算;二代健保是估計值,請以入帳金額為準。
      </p>

      <ul className="divide-hairline mt-3" style={{ borderTop: '1px solid var(--divider)' }}>
        {suggestions.map((s) => {
          const name = names.get(s.symbol);
          const isCash = s.kind === 'dividend';
          return (
            <li
              key={`${s.symbol}-${s.exDate}-${s.kind}`}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
            >
              <div className="min-w-0 text-sm">
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate font-medium">{name ?? s.symbol}</span>
                  {name && (
                    <span className="tnum shrink-0 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {s.symbol}
                    </span>
                  )}
                  <span className="shrink-0 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {formatDate(s.exDate)} {isCash ? '除息' : '除權'}
                  </span>
                </div>
                <div className="tnum mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {isCash ? (
                    <>
                      每股 {s.perShare} × {formatShares(s.shares)} 股 ＝ {formatNumber(Math.round(s.gross))}
                      {s.deduction > 0 && `(扣款約 ${formatNumber(s.deduction)})`}
                    </>
                  ) : (
                    <>
                      每千股配 {formatNumber(Math.round(s.perShare * 1000 * 100) / 100, 0)} 股,持有{' '}
                      {formatShares(s.heldShares)} 股 → 配 {formatShares(s.shares)} 股
                    </>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <form action={dismissDividendSuggestion}>
                  <input type="hidden" name="symbol" value={s.symbol} />
                  <input type="hidden" name="ex_date" value={s.exDate} />
                  <input type="hidden" name="kind" value={s.kind} />
                  <button
                    type="submit"
                    className="min-h-[36px] px-2 text-xs underline underline-offset-2"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    略過
                  </button>
                </form>
                <StockTransactionForm
                  brokerAccounts={brokerAccounts}
                  triggerLabel="記錄"
                  preset={{
                    market: s.market,
                    symbol: s.symbol,
                    name: name ?? null,
                    type: s.kind,
                    shares: s.shares,
                    price: isCash ? s.perShare : 0,
                    fee: s.deduction,
                    transaction_date: s.exDate,
                    pay_date: null,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
