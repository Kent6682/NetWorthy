/**
 * 每日盈虧 —— 純函式,不碰資料庫。
 *
 * 核心公式:
 *   當日盈虧 = 今日總資產 − 昨日總資產 − 今日外部資金流入
 *
 * 那個減項是重點。不扣掉的話,你存 10 萬進銀行,日曆會顯示「今天賺 10 萬」。
 * 哪些算外部流入由 lib/queries.ts 的查詢決定(存入與提出算,帳戶間轉帳、
 * 股票交割、對帳調整都不算 —— 詳見那裡的註解)。
 */

export interface DailyPnl {
  date: string;
  /** null 代表這天算不出來:沒有快照,或沒有前一天可以比 */
  pnl: number | null;
  percent: number | null;
  total: number | null;
}

/** YYYY-MM-DD 的前一天 */
export function previousDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * 算出每一天的盈虧。
 *
 * `totalsByDate` 必須包含 `days` 第一天的**前一天**,否則那天算不出來。
 */
export function computeDailyPnl(
  totalsByDate: Map<string, number>,
  flowsByDate: Map<string, number>,
  days: string[]
): DailyPnl[] {
  return days.map((date) => {
    const total = totalsByDate.get(date);
    const prev = totalsByDate.get(previousDay(date));

    if (total === undefined || prev === undefined) {
      return { date, pnl: null, percent: null, total: total ?? null };
    }

    const pnl = total - prev - (flowsByDate.get(date) ?? 0);

    return {
      date,
      pnl,
      // 前一天是 0 的話算不出比率(第一天就是這種情形)
      percent: prev !== 0 ? (pnl / prev) * 100 : null,
      total,
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
