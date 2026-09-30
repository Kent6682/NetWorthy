/**
 * 「待確認配息」—— 從交易所的除權息公告,找出使用者領得到、但還沒記錄的股利。
 *
 * 領不領得到看**除息日前一天收盤時**的持股:除息日當天才買進的領不到,
 * 除息日當天賣掉的照樣領得到。所以用「交易日早於除息日」的交易算持股。
 *
 * 只提示除息日已經到了的(今天或以前);金額還沒公布的也先不提示。
 */

import { estimateDividendDeduction } from './fees.ts';
import { calculateHolding, type StockTransaction } from './holdings.ts';

export interface CorporateAction {
  market: 'TW' | 'US';
  symbol: string;
  ex_date: string;
  /** 每股現金股利;還沒公布是 null */
  cash_dividend: number | null;
  /** 每股配幾股(0.05 = 每千股 50 股);沒有配股是 null */
  stock_ratio: number | null;
}

export interface DividendDismissal {
  symbol: string;
  ex_date: string;
  kind: 'dividend' | 'stock_dividend';
}

export interface DividendSuggestion {
  kind: 'dividend' | 'stock_dividend';
  market: 'TW' | 'US';
  symbol: string;
  exDate: string;
  /** 除息日前一天收盤時的持股 */
  heldShares: number;
  /** 現金股利是每股金額;配股是每股配幾股 */
  perShare: number;
  /** 現金股利 = 持股;配股 = 配到的股數 */
  shares: number;
  /** 現金股利總額;配股是 0 */
  gross: number;
  /** 預估的二代健保或預扣稅;配股是 0 */
  deduction: number;
}

/**
 * 配到的股數:持股 × 配股率,不足一股的部分捨去(實務上會折算現金發放)。
 * 交易所給的配股率像 0.04999999,先四捨五入到小數 6 位,否則 23,100 股會算成 1,154。
 */
export function stockDividendShares(held: number, ratio: number): number {
  const r = Math.round(ratio * 1e6) / 1e6;
  return Math.floor(held * r + 1e-9);
}

export function dividendSuggestions(
  /** 只放**自己**的交易 —— 只能替自己記錄 */
  ownTxns: StockTransaction[],
  actions: CorporateAction[],
  dismissals: DividendDismissal[],
  today: string
): DividendSuggestion[] {
  const dismissed = new Set(dismissals.map((d) => `${d.symbol}|${d.ex_date}|${d.kind}`));
  const bySymbol = new Map<string, StockTransaction[]>();
  for (const t of ownTxns) {
    const list = bySymbol.get(t.symbol);
    if (list) list.push(t);
    else bySymbol.set(t.symbol, [t]);
  }

  const out: DividendSuggestion[] = [];

  for (const a of actions) {
    if (a.ex_date > today) continue;
    const txns = bySymbol.get(a.symbol);
    if (!txns) continue;

    const before = txns.filter((t) => t.transaction_date < a.ex_date);
    const held = before.length > 0 ? (calculateHolding(before)?.shares ?? 0) : 0;
    if (held <= 0) continue;

    const recorded = (kind: DividendSuggestion['kind']) =>
      txns.some((t) => t.type === kind && t.transaction_date === a.ex_date) ||
      dismissed.has(`${a.symbol}|${a.ex_date}|${kind}`);

    if (a.cash_dividend !== null && a.cash_dividend > 0 && !recorded('dividend')) {
      const gross = Math.round(held * a.cash_dividend * 100) / 100;
      out.push({
        kind: 'dividend',
        market: a.market,
        symbol: a.symbol,
        exDate: a.ex_date,
        heldShares: held,
        perShare: a.cash_dividend,
        shares: held,
        gross,
        deduction: estimateDividendDeduction(a.market, gross)?.amount ?? 0,
      });
    }

    if (a.stock_ratio !== null && a.stock_ratio > 0 && !recorded('stock_dividend')) {
      const received = stockDividendShares(held, a.stock_ratio);
      if (received >= 1) {
        out.push({
          kind: 'stock_dividend',
          market: a.market,
          symbol: a.symbol,
          exDate: a.ex_date,
          heldShares: held,
          perShare: a.stock_ratio,
          shares: received,
          gross: 0,
          deduction: 0,
        });
      }
    }
  }

  // 新的在前
  return out.sort((x, y) => y.exDate.localeCompare(x.exDate) || x.symbol.localeCompare(y.symbol));
}
