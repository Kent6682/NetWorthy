/**
 * 持股均價計算 — 移動加權平均法
 *
 * 規則:
 *   initial(期初持股)  直接以輸入的股數與均價作為起點
 *   buy   (買進)       新均價 = (原持股 × 原均價 + 買進股數 × 買進價 + 手續費) ÷ 總股數
 *   sell  (賣出)       均價不變,持股數減少,總成本按均價等比減少,差額計入已實現損益
 *
 * 這支模組同時被網站與每日同步腳本使用,是均價的唯一真實來源。
 */

export type StockTxnType = 'initial' | 'buy' | 'sell';

export interface StockTransaction {
  id: string;
  owner_id: string;
  symbol: string;
  type: StockTxnType;
  shares: number;
  price: number;
  fee: number;
  transaction_date: string; // YYYY-MM-DD
  created_at?: string;
}

export interface Holding {
  symbol: string;
  ownerId: string;
  /** 目前持股數 */
  shares: number;
  /** 移動加權平均成本(該股票原幣別) */
  avgCost: number;
  /** 總成本 = shares × avgCost */
  totalCost: number;
  /** 已實現損益(賣出時結算,原幣別) */
  realizedPnL: number;
}

/** 浮點數容差:股數小於這個值視為已清空 */
const EPSILON = 1e-9;

function round(value: number, digits = 6): number {
  const f = 10 ** digits;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** 交易排序:先依交易日,同日再依建立時間,最後依 id,確保計算結果穩定可重現 */
function compareTransactions(a: StockTransaction, b: StockTransaction): number {
  if (a.transaction_date !== b.transaction_date) {
    return a.transaction_date < b.transaction_date ? -1 : 1;
  }
  // 同一天:期初持股永遠排最前面,否則買賣會算在錯誤的基準上
  const rank = (t: StockTxnType) => (t === 'initial' ? 0 : 1);
  if (rank(a.type) !== rank(b.type)) return rank(a.type) - rank(b.type);

  const ac = a.created_at ?? '';
  const bc = b.created_at ?? '';
  if (ac !== bc) return ac < bc ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 依單一標的的交易紀錄算出目前持股狀態。
 * 傳入的交易必須是同一人、同一檔股票。
 */
export function calculateHolding(transactions: StockTransaction[]): Holding | null {
  if (transactions.length === 0) return null;

  const sorted = [...transactions].sort(compareTransactions);
  const { symbol, owner_id: ownerId } = sorted[0];

  let shares = 0;
  let totalCost = 0;
  let realizedPnL = 0;

  for (const txn of sorted) {
    if (txn.type === 'initial') {
      // 期初持股:直接設定基準,不累加(schema 已保證每人每檔最多一筆)
      shares = txn.shares;
      totalCost = txn.shares * txn.price;
      continue;
    }

    if (txn.type === 'buy') {
      totalCost += txn.shares * txn.price + (txn.fee ?? 0);
      shares += txn.shares;
      continue;
    }

    // sell — 賣出不改變均價,只按均價把成本移出
    const avg = shares > EPSILON ? totalCost / shares : 0;
    // 賣超時以實際持股為上限,避免出現負股數
    const soldShares = Math.min(txn.shares, shares);
    const costRemoved = avg * soldShares;
    const proceeds = soldShares * txn.price - (txn.fee ?? 0);

    realizedPnL += proceeds - costRemoved;
    totalCost -= costRemoved;
    shares -= soldShares;

    if (shares <= EPSILON) {
      shares = 0;
      totalCost = 0;
    }
  }

  return {
    symbol,
    ownerId,
    shares: round(shares, 4),
    avgCost: shares > EPSILON ? round(totalCost / shares, 4) : 0,
    totalCost: round(totalCost, 2),
    realizedPnL: round(realizedPnL, 2),
  };
}

/**
 * 把一整批交易(多人、多檔)算成持股清單。
 * 依「持有人 + 股票代號」分組,各自獨立計算。
 */
export function calculateHoldings(transactions: StockTransaction[]): Holding[] {
  const groups = new Map<string, StockTransaction[]>();

  for (const txn of transactions) {
    const key = `${txn.owner_id}::${txn.symbol}`;
    const list = groups.get(key);
    if (list) list.push(txn);
    else groups.set(key, [txn]);
  }

  const holdings: Holding[] = [];
  for (const list of groups.values()) {
    const holding = calculateHolding(list);
    if (holding) holdings.push(holding);
  }
  return holdings;
}

/**
 * 合併多位家庭成員的同一檔持股(首頁「全家」視角用)。
 * 合併後的均價一樣是加權平均:總成本 ÷ 總股數。
 */
export function mergeHoldingsBySymbol(holdings: Holding[]): Omit<Holding, 'ownerId'>[] {
  const merged = new Map<string, { shares: number; totalCost: number; realizedPnL: number }>();

  for (const h of holdings) {
    const acc = merged.get(h.symbol) ?? { shares: 0, totalCost: 0, realizedPnL: 0 };
    acc.shares += h.shares;
    acc.totalCost += h.totalCost;
    acc.realizedPnL += h.realizedPnL;
    merged.set(h.symbol, acc);
  }

  return [...merged.entries()].map(([symbol, acc]) => ({
    symbol,
    shares: round(acc.shares, 4),
    avgCost: acc.shares > EPSILON ? round(acc.totalCost / acc.shares, 4) : 0,
    totalCost: round(acc.totalCost, 2),
    realizedPnL: round(acc.realizedPnL, 2),
  }));
}
