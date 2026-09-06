/**
 * 每日總資產快照的計算 —— 純函式,不碰資料庫。
 *
 * 每日同步與歷史回填共用這一份。抽出來的理由跟 holdings.ts 一樣:
 * 有兩個地方要算同一件事的時候,就必須只有一份實作。
 *
 * 關鍵設計:交易紀錄整批傳進來,由這支函式自己依日期過濾。
 * 回填時才能撈一次資料就把好幾個月的每一天都算出來,不必每天各查一次資料庫。
 */

import { calculateHoldings, type StockTransaction } from './holdings.ts';

export interface SnapshotProfile {
  id: string;
  household_id: string | null;
}

export interface SnapshotAccount {
  id: string;
  owner_id: string;
  currency: string;
  is_archived: boolean;
}

export interface SnapshotAccountTxn {
  account_id: string;
  signed_amount: number | string;
  transaction_date: string;
}

export interface SnapshotSources {
  /** 只含已經加入家庭的成員 */
  profiles: SnapshotProfile[];
  accounts: SnapshotAccount[];
  /** 全部的帳戶流水,不需要先依日期過濾 */
  accountTxns: SnapshotAccountTxn[];
  /** 全部的股票交易,不需要先依日期過濾 */
  stockTxns: StockTransaction[];
  currencyBySymbol: Map<string, string>;
}

export interface SnapshotRow {
  household_id: string;
  owner_id: string | null;
  snapshot_date: string;
  cash_twd: number;
  stock_twd: number;
  total_twd: number;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * 算出某一天收盤後,每位成員與每個家庭的總資產。
 *
 * @param date      要算哪一天(YYYY-MM-DD)。當天(含)以前的交易才算數。
 * @param priceOn   查該檔股票在這一天的收盤價;沒有就回 null,會退回成本價估算。
 * @param usdToTwd  這一天的美元匯率。
 */
export function computeSnapshotRows(
  sources: SnapshotSources,
  date: string,
  priceOn: (symbol: string) => number | null,
  usdToTwd: number
): SnapshotRow[] {
  const { profiles, accounts, accountTxns, stockTxns, currencyBySymbol } = sources;
  if (profiles.length === 0) return [];

  // --- 現金:流水帳累加到這一天為止 ---------------------------------------
  const balanceByAccount = new Map<string, number>();
  for (const t of accountTxns) {
    if (t.transaction_date > date) continue;
    balanceByAccount.set(
      t.account_id,
      (balanceByAccount.get(t.account_id) ?? 0) + Number(t.signed_amount)
    );
  }

  const cashByOwner = new Map<string, number>();
  for (const a of accounts) {
    if (a.is_archived) continue;
    const raw = balanceByAccount.get(a.id) ?? 0;
    const twd = a.currency === 'USD' ? raw * usdToTwd : raw;
    cashByOwner.set(a.owner_id, (cashByOwner.get(a.owner_id) ?? 0) + twd);
  }

  // --- 股票:持股算到這一天,再用當天的收盤價估值 -------------------------
  const stockByOwner = new Map<string, number>();
  const upToDate = stockTxns.filter((t) => t.transaction_date <= date);

  for (const h of calculateHoldings(upToDate)) {
    if (h.shares <= 0) continue;
    // 沒有報價時退回成本價,總資產不會因為缺一天報價就憑空少一塊
    const price = priceOn(h.symbol) ?? h.avgCost;
    const value = h.shares * price;
    const twd = currencyBySymbol.get(h.symbol) === 'USD' ? value * usdToTwd : value;
    stockByOwner.set(h.ownerId, (stockByOwner.get(h.ownerId) ?? 0) + twd);
  }

  // --- 每人一列 + 每個家庭一列合計 ---------------------------------------
  const rows: SnapshotRow[] = [];
  const householdTotals = new Map<string, { cash: number; stock: number }>();

  for (const p of profiles) {
    if (!p.household_id) continue;

    const cash = cashByOwner.get(p.id) ?? 0;
    const stock = stockByOwner.get(p.id) ?? 0;

    rows.push({
      household_id: p.household_id,
      owner_id: p.id,
      snapshot_date: date,
      cash_twd: round2(cash),
      stock_twd: round2(stock),
      total_twd: round2(cash + stock),
    });

    const agg = householdTotals.get(p.household_id) ?? { cash: 0, stock: 0 };
    agg.cash += cash;
    agg.stock += stock;
    householdTotals.set(p.household_id, agg);
  }

  for (const [householdId, agg] of householdTotals) {
    rows.push({
      household_id: householdId,
      owner_id: null, // null = 全家合計
      snapshot_date: date,
      cash_twd: round2(agg.cash),
      stock_twd: round2(agg.stock),
      total_twd: round2(agg.cash + agg.stock),
    });
  }

  return rows;
}

/** 產生 from 到 to 之間的每一天(含頭尾),YYYY-MM-DD */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * 把「有交易的那幾天才有價格」補成「每一天都有價格」。
 *
 * 收盤價只在交易日存在,但快照是每天都要算的。週末與假日沿用最近一次的收盤價
 * —— 那正是那幾天的實際市值。
 */
export function carryForward(
  pricesByDate: Map<string, number>,
  days: string[]
): Map<string, number> {
  const filled = new Map<string, number>();
  let last: number | null = null;

  for (const day of days) {
    const price = pricesByDate.get(day);
    if (price !== undefined) last = price;
    if (last !== null) filled.set(day, last);
  }
  return filled;
}
