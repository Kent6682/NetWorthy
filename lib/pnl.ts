/**
 * 每日盈虧 —— 純函式,不碰資料庫。
 *
 * 公式:
 *   當日盈虧 = 股票市值變化 − 當日買進金額 + 當日賣出金額 − 當日手續費與稅
 *
 * 兩個重點:
 *
 * 1. **基準是股票市值,不是總資產。** 用總資產的話,沒有勾選「同步更新券商
 *    帳戶餘額」的買賣會憑空生出資產 —— 股票增加了,現金卻沒減少。
 *
 * 2. **交易造成的部位變動要扣掉。** 買進 50 萬不是賺 50 萬,那只是現金換成
 *    股票。扣掉之後剩下的才是市場給你的漲跌,而手續費與稅則是真的成本。
 *
 * 期初持股當天不算盈虧 —— 那天你既沒賺也沒賠,只是把本來就有的部位輸入進來。
 *
 * 現金完全不參與。銀行利息不會顯示成盈虧,對帳調整也一樣(那是帳務更正,
 * 錢一直都在,算進去只會產生假的尖峰)。
 */

import { calculateHoldings, type StockTransaction } from './holdings.ts';

export interface DayTrades {
  /** 當天導入了幾檔期初持股 */
  initial: number;
  buy: number;
  sell: number;
  /**
   * 部位變動造成的金額,要從市值變化裡扣掉。
   * 買進記 +(股數×價格＋手續費),賣出記 −(股數×價格−手續費與稅)。
   */
  adjustment: number;
}

export interface DailyPnl {
  date: string;
  /** null 代表這天算不出來:沒有資料、沒有前一天可比,或那天是導入日 */
  pnl: number | null;
  percent: number | null;
  stock: number | null;
  trades: DayTrades | null;
}

/** 算盈虧與做標記時要看的交易欄位 */
export interface TradeRow {
  type: 'initial' | 'buy' | 'sell';
  symbol: string;
  shares: number;
  price: number;
  fee: number;
  transaction_date: string;
}

/** YYYY-MM-DD 的前一天 */
export function previousDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** 把交易依日期分組,並算出當天的部位變動金額 */
export function groupTradesByDate(rows: TradeRow[]): Map<string, DayTrades> {
  const byDate = new Map<string, DayTrades>();

  for (const r of rows) {
    const day = byDate.get(r.transaction_date) ?? {
      initial: 0,
      buy: 0,
      sell: 0,
      adjustment: 0,
    };

    const gross = r.shares * r.price;

    if (r.type === 'initial') {
      day.initial += 1;
      // 導入日整天不算盈虧,不需要 adjustment
    } else if (r.type === 'buy') {
      day.buy += 1;
      day.adjustment += gross + r.fee;
    } else {
      day.sell += 1;
      day.adjustment -= gross - r.fee;
    }

    byDate.set(r.transaction_date, day);
  }

  return byDate;
}

/**
 * 算出每一天的盈虧。
 *
 * `stockByDate` 必須包含 `days` 第一天的**前一天**,否則那天算不出來。
 */
export function computeDailyPnl(
  stockByDate: Map<string, number>,
  tradesByDate: Map<string, DayTrades>,
  days: string[]
): DailyPnl[] {
  return days.map((date) => {
    const stock = stockByDate.get(date);
    const prev = stockByDate.get(previousDay(date));
    const trades = tradesByDate.get(date) ?? null;

    const base = {
      date,
      stock: stock ?? null,
      trades,
    };

    // 導入日:既沒賺也沒賠,只是把既有部位輸入進來
    if (trades && trades.initial > 0) {
      return { ...base, pnl: null, percent: null };
    }

    if (stock === undefined || prev === undefined) {
      return { ...base, pnl: null, percent: null };
    }

    const pnl = stock - prev - (trades?.adjustment ?? 0);

    return {
      ...base,
      pnl,
      // 前一天是 0 的話算不出比率
      percent: prev !== 0 ? (pnl / prev) * 100 : null,
    };
  });
}

/**
 * 把收盤價列表變成「查某檔在某天的價格」的函式。
 *
 * 收盤價只有交易日才有,所以查不到當天時往回找最近一次 —— 週末與假日
 * 的市值就是沿用前一個交易日的收盤價,這跟快照的算法一致。
 */
export function buildPriceLookup(
  rows: { symbol: string; price_date: string; close_price: number }[]
): (symbol: string, date: string) => number | null {
  const bySymbol = new Map<string, { date: string; price: number }[]>();

  for (const r of rows) {
    const list = bySymbol.get(r.symbol) ?? [];
    list.push({ date: r.price_date, price: r.close_price });
    bySymbol.set(r.symbol, list);
  }
  for (const list of bySymbol.values()) list.sort((a, b) => a.date.localeCompare(b.date));

  return (symbol, date) => {
    const list = bySymbol.get(symbol);
    if (!list) return null;

    let found: number | null = null;
    for (const row of list) {
      if (row.date > date) break;
      found = row.price;
    }
    return found;
  };
}

/** 單日明細裡的一檔 */
export interface HoldingPnl {
  symbol: string;
  /** 當日持股;賣光的那天會是 0,但仍然列出來(它那天有貢獻盈虧) */
  shares: number;
  prevShares: number;
  price: number;
  prevPrice: number;
  /** null 代表這檔當天是導入既有部位,不計盈虧 */
  pnl: number | null;
  /** 盈虧佔前一日市值的百分比;當天才建立的部位沒有基準,是 null */
  percent: number | null;
  trades: TradeRow[];
}

/**
 * 把某一天的盈虧拆成每一檔。
 *
 * 每檔盈虧 = 當日市值 − 前日市值 − 當天買賣造成的部位變動
 *
 * 加總會精確等於 computeDailyPnl() 給的當日盈虧 —— 兩邊用的是同一套規則:
 * 同樣的持股計算(lib/holdings.ts)、同樣的缺價退回成本價、同樣的交易扣除。
 * 估價方式跟快照不一致的話,點進去的明細就會跟日曆格子對不起來。
 */
export function computeHoldingPnl(
  txns: StockTransaction[],
  date: string,
  priceOn: (symbol: string, date: string) => number | null
): HoldingPnl[] {
  const prev = previousDay(date);

  const holdNow = new Map(
    calculateHoldings(txns.filter((t) => t.transaction_date <= date)).map((h) => [h.symbol, h])
  );
  const holdPrev = new Map(
    calculateHoldings(txns.filter((t) => t.transaction_date <= prev)).map((h) => [h.symbol, h])
  );
  const todayTrades = txns.filter((t) => t.transaction_date === date);

  const rows: HoldingPnl[] = [];

  for (const symbol of new Set([...holdNow.keys(), ...holdPrev.keys()])) {
    const now = holdNow.get(symbol);
    const before = holdPrev.get(symbol);
    const shares = now?.shares ?? 0;
    const prevShares = before?.shares ?? 0;
    if (shares <= 0 && prevShares <= 0) continue;

    // 缺報價時退回成本價,跟快照的規則一致
    const price = priceOn(symbol, date) ?? now?.avgCost ?? 0;
    const prevPrice = priceOn(symbol, prev) ?? before?.avgCost ?? 0;

    const trades = todayTrades.filter((t) => t.symbol === symbol) as TradeRow[];

    let adjustment = 0;
    let imported = false;
    for (const t of trades) {
      if (t.type === 'initial') imported = true;
      else if (t.type === 'buy') adjustment += t.shares * t.price + t.fee;
      else adjustment -= t.shares * t.price - t.fee;
    }

    const prevValue = prevShares * prevPrice;
    const pnl = imported ? null : shares * price - prevValue - adjustment;

    rows.push({
      symbol,
      shares,
      prevShares,
      price,
      prevPrice,
      pnl,
      // 基準是前一日的市值。當天才建立的部位沒有前一日,給不出比率
      percent: pnl === null || prevValue === 0 ? null : (pnl / prevValue) * 100,
      trades,
    });
  }

  // 影響最大的排前面 —— 打開明細通常是想知道「今天是誰害的」
  return rows.sort((a, b) => Math.abs(b.pnl ?? 0) - Math.abs(a.pnl ?? 0));
}

/** 這個月的每一天,YYYY-MM-DD */
export function daysInMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const days: string[] = [];
  const cursor = new Date(Date.UTC(y, m - 1, 1));

  while (cursor.getUTCMonth() === m - 1) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * 排成月曆的格子:每列 7 天,週日起算(台灣習慣的 日一二三四五六)。
 * 首尾補 null 對齊星期。
 */
export function monthGrid(month: string): (string | null)[][] {
  const days = daysInMonth(month);
  const firstWeekday = new Date(`${days[0]}T00:00:00Z`).getUTCDay();

  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...days,
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** 相鄰的月份,YYYY-MM */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 把 ?month= 的值收成 YYYY-MM,不合法就退回 fallback */
export function parseMonth(value: string | undefined, fallback: string): string {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : fallback;
}

/** 把 ?day= 的值收成 YYYY-MM-DD,格式不對或不屬於這個月就當成沒選 */
export function parseDay(value: string | undefined, month: string): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return value.startsWith(`${month}-`) && daysInMonth(month).includes(value) ? value : undefined;
}

/** 當月合計 —— 只加算得出來的那幾天 */
export function monthTotal(rows: DailyPnl[]): { pnl: number; days: number } {
  let pnl = 0;
  let days = 0;
  for (const r of rows) {
    if (r.pnl === null) continue;
    pnl += r.pnl;
    days += 1;
  }
  return { pnl, days };
}
