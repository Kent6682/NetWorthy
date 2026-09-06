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
