/**
 * 年度損益 —— 首頁「今年未實現 / 今年已實現」與總覽下方的年度表。
 *
 * 每一年當成一段期間來結算:
 *
 *   當年總損益 = 期末股票市值 − 期初股票市值 − 當年買入 + 當年賣出實收 + 當年股利實收
 *   當年已實現 = 當年每筆賣出的(實收價款 − 按均價移出的成本)
 *   當年未實現 = 當年總損益 − 當年已實現
 *
 * 「期初」是前一年 12/31 收盤,「期末」是當年 12/31 收盤,今年則是最新收盤。
 * 買入包含導入的期初持股(以當初輸入的成本計),否則導入那年會憑空多出
 * 整包持股的市值當作獲利。
 *
 * 未實現是「變動」而不是年底的帳面數字,所以各年直接相加就等於目前的帳面
 * 未實現 —— 全部統計才能是各年的加總。代價是:賣出那年,之前累積的帳面獲利
 * 會從未實現搬到已實現,那年的未實現可能是負的,但那不是虧損。
 *
 * 只看股票,不看現金 —— 理由跟每日盈虧一樣:薪水入帳、沒勾連動的買賣都會
 * 讓總資產變動,但那不是投資的賺賠。
 */

import { calculateHoldings, dividendNet, type StockTransaction } from './holdings.ts';
import type { Currency } from './types.ts';

export interface YearRow {
  /** 年度;全部統計那列是 null */
  year: number | null;
  /** 期初股票市值(台幣) */
  startValue: number;
  /** 期末股票市值(台幣) */
  endValue: number;
  /** 當年買入,含手續費與導入的期初持股(台幣) */
  bought: number;
  /** 當年賣出實收,已扣手續費與稅(台幣) */
  sold: number;
  /** 當年現金股利實收,已扣二代健保等(台幣) */
  dividends: number;
  total: number;
  /** 已實現 = 買賣的已實現 + 股利實收 */
  realized: number;
  /** 其中買賣的部分 */
  tradingRealized: number;
  unrealized: number;
  /**
   * 股利所得(報稅核對用):現金股利總額、扣掉的二代健保與預扣稅、
   * 配股以面額 10 元計的股利所得。只是核對用,正式數字以國稅局資料為準。
   */
  tax: {
    cashGross: number;
    deductions: number;
    stockPar: number;
  };
}

/** 台股配股以面額計入股利所得,絕大多數公司面額是 10 元 */
const TW_PAR_VALUE = 10;

export interface YearlyInput {
  transactions: StockTransaction[];
  currencyOf: (symbol: string) => Currency;
  /** 某檔在某天(含)以前最近一次的收盤價;查不到回 null */
  priceOn: (symbol: string, date: string) => number | null;
  /** 某天(含)以前最近一次的美元兌台幣匯率 */
  usdToTwdOn: (date: string) => number;
  /** 今天,YYYY-MM-DD —— 今年的期末用這天 */
  today: string;
}

/** 算年度表需要查價的日子:每年的前一年底,加上今天 */
export function yearBoundaries(transactions: StockTransaction[], today: string): string[] {
  const years = yearsCovered(transactions, today);
  if (years.length === 0) return [];
  return [...years.map((y) => `${y - 1}-12-31`), today];
}

function yearsCovered(transactions: StockTransaction[], today: string): number[] {
  if (transactions.length === 0) return [];
  const first = Number(
    transactions.reduce(
      (min, t) => (t.transaction_date < min ? t.transaction_date : min),
      transactions[0].transaction_date
    ).slice(0, 4)
  );
  const last = Number(today.slice(0, 4));
  const years: number[] = [];
  for (let y = first; y <= last; y += 1) years.push(y);
  return years;
}

export function computeYearly(input: YearlyInput): YearRow[] {
  const { transactions, currencyOf, priceOn, usdToTwdOn, today } = input;
  const years = yearsCovered(transactions, today);

  const toTwd = (amount: number, symbol: string, date: string) =>
    currencyOf(symbol) === 'USD' ? amount * usdToTwdOn(date) : amount;

  /** 某天收盤時的股票市值;缺報價退回成本價,跟快照的規則一致 */
  const valueAt = (date: string) =>
    calculateHoldings(transactions.filter((t) => t.transaction_date <= date)).reduce(
      (sum, h) =>
        h.shares > 0
          ? sum + toTwd(h.shares * (priceOn(h.symbol, date) ?? h.avgCost), h.symbol, date)
          : sum,
      0
    );

  /**
   * 到某天為止累計的已實現損益,**原幣別**、依代號分組。
   * 先在原幣別相減再換匯 —— 兩個年底各用各的匯率換完再相減的話,
   * 前幾年的美股已實現會被匯率變動重新計價一次,混進今年。
   */
  const realizedUpTo = (date: string) => {
    const bySymbol = new Map<string, number>();
    for (const h of calculateHoldings(transactions.filter((t) => t.transaction_date <= date))) {
      bySymbol.set(h.symbol, (bySymbol.get(h.symbol) ?? 0) + h.realizedPnL);
    }
    return bySymbol;
  };

  const rows: YearRow[] = years.map((year) => {
    const start = `${year - 1}-12-31`;
    const end = year === Number(today.slice(0, 4)) ? today : `${year}-12-31`;

    let bought = 0;
    let sold = 0;
    let dividends = 0;
    let cashGross = 0;
    let stockPar = 0;
    for (const t of transactions) {
      if (t.transaction_date <= start || t.transaction_date > end) continue;
      const amount = t.shares * t.price;
      const twd = (v: number) => toTwd(v, t.symbol, t.transaction_date);

      if (t.type === 'sell') {
        sold += twd(amount - (t.fee ?? 0));
      } else if (t.type === 'dividend') {
        // 股利在除息日入帳 —— 跟當天股價下跌的那一段同一天算
        dividends += twd(dividendNet(t));
        cashGross += twd(amount);
      } else if (t.type === 'stock_dividend') {
        // 零成本的股數,不是買入;美股沒有「面額計稅」這回事
        if (currencyOf(t.symbol) !== 'USD') stockPar += t.shares * TW_PAR_VALUE;
      } else {
        // 期初持股與買進
        bought += twd(amount + (t.fee ?? 0));
      }
    }

    const startValue = valueAt(start);
    const endValue = valueAt(end);
    const total = endValue - startValue - bought + sold + dividends;
    const before = realizedUpTo(start);
    let tradingRealized = 0;
    for (const [symbol, cum] of realizedUpTo(end)) {
      tradingRealized += toTwd(cum - (before.get(symbol) ?? 0), symbol, end);
    }
    const realized = tradingRealized + dividends;

    return {
      year,
      startValue,
      endValue,
      bought,
      sold,
      dividends,
      total,
      realized,
      tradingRealized,
      unrealized: total - realized,
      tax: { cashGross, deductions: cashGross - dividends, stockPar },
    };
  });

  return rows;
}

/** 全部統計:各年加總,期初是第一年的期初、期末是最後一年的期末 */
export function sumYears(rows: YearRow[]): YearRow | null {
  if (rows.length === 0) return null;
  const sum = (pick: (r: YearRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  return {
    year: null,
    startValue: rows[0].startValue,
    endValue: rows[rows.length - 1].endValue,
    bought: sum((r) => r.bought),
    sold: sum((r) => r.sold),
    dividends: sum((r) => r.dividends),
    total: sum((r) => r.total),
    realized: sum((r) => r.realized),
    tradingRealized: sum((r) => r.tradingRealized),
    unrealized: sum((r) => r.unrealized),
    tax: {
      cashGross: sum((r) => r.tax.cashGross),
      deductions: sum((r) => r.tax.deductions),
      stockPar: sum((r) => r.tax.stockPar),
    },
  };
}
