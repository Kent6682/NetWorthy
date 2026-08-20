/**
 * 把資料庫撈出來的原始資料,組成首頁與股票頁需要的樣子。
 * 這裡是唯一做「幣別換算成台幣」的地方。
 */

import { calculateHoldings, type Holding, type StockTransaction } from './holdings.ts';
import type { AccountBalance, Stock, LatestPrice, Currency } from './types.ts';

export interface ValuedHolding extends Holding {
  market: 'TW' | 'US';
  name: string | null;
  currency: Currency;
  /** 最新收盤價(原幣別);沒有報價時為 null */
  lastPrice: number | null;
  lastPriceDate: string | null;
  /** 市值(原幣別) */
  marketValue: number;
  /** 市值(換算台幣) */
  marketValueTwd: number;
  /** 未實現損益(原幣別) */
  unrealizedPnL: number;
  /** 未實現損益率 % */
  unrealizedPnLPercent: number;
}

export interface AssetSlice {
  /** 唯一鍵,顏色依這個綁定,不隨排序改變 */
  key: string;
  label: string;
  sublabel: string;
  valueTwd: number;
  kind: 'stock' | 'bank' | 'broker_cash';
}

/** 幣別換算成台幣 */
export function toTwd(amount: number, currency: Currency, usdToTwd: number): number {
  return currency === 'USD' ? amount * usdToTwd : amount;
}

/**
 * 把交易紀錄 + 最新報價組成有市值的持股清單。
 * 已清空(股數 0)的標的會被濾掉。
 */
export function buildValuedHoldings(
  transactions: StockTransaction[],
  stocks: Stock[],
  prices: LatestPrice[],
  usdToTwd: number
): ValuedHolding[] {
  const stockMap = new Map(stocks.map((s) => [s.symbol, s]));
  const priceMap = new Map(prices.map((p) => [p.symbol, p]));

  return calculateHoldings(transactions)
    .filter((h) => h.shares > 0)
    .map((h) => {
      const stock = stockMap.get(h.symbol);
      const price = priceMap.get(h.symbol);
      const currency: Currency = stock?.currency ?? 'TWD';

      // 沒有報價時退回成本價,總資產不會因為缺一天報價就掉一塊
      const lastPrice = price?.close_price ?? null;
      const effectivePrice = lastPrice ?? h.avgCost;

      const marketValue = h.shares * effectivePrice;
      const unrealizedPnL = marketValue - h.totalCost;

      return {
        ...h,
        market: stock?.market ?? 'TW',
        name: stock?.name ?? null,
        currency,
        lastPrice,
        lastPriceDate: price?.price_date ?? null,
        marketValue,
        marketValueTwd: toTwd(marketValue, currency, usdToTwd),
        unrealizedPnL,
        unrealizedPnLPercent: h.totalCost > 0 ? (unrealizedPnL / h.totalCost) * 100 : 0,
      };
    })
    .sort((a, b) => b.marketValueTwd - a.marketValueTwd);
}

/**
 * 組出圓餅圖需要的資產切片:每檔股票一片、每個帳戶一片。
 */
export function buildAssetSlices(
  holdings: ValuedHolding[],
  balances: AccountBalance[],
  usdToTwd: number
): AssetSlice[] {
  const stockSlices: AssetSlice[] = holdings.map((h) => ({
    key: `stock:${h.symbol}`,
    label: h.symbol,
    sublabel: h.name ?? (h.market === 'TW' ? '台股' : '美股'),
    valueTwd: h.marketValueTwd,
    kind: 'stock',
  }));

  const accountSlices: AssetSlice[] = balances
    .filter((b) => !b.is_archived && b.balance !== 0)
    .map((b) => ({
      key: `account:${b.account_id}`,
      label: b.nickname ? `${b.institution}・${b.nickname}` : b.institution,
      sublabel: b.type === 'bank' ? '銀行' : '券商現金',
      valueTwd: toTwd(Number(b.balance), b.currency, usdToTwd),
      kind: b.type,
    }));

  return [...stockSlices, ...accountSlices]
    .filter((s) => s.valueTwd > 0)
    .sort((a, b) => b.valueTwd - a.valueTwd);
}

export interface PortfolioTotals {
  stockTwd: number;
  cashTwd: number;
  totalTwd: number;
  unrealizedPnLTwd: number;
  realizedPnLTwd: number;
}

export function computeTotals(
  holdings: ValuedHolding[],
  balances: AccountBalance[],
  usdToTwd: number
): PortfolioTotals {
  const stockTwd = holdings.reduce((sum, h) => sum + h.marketValueTwd, 0);

  const cashTwd = balances
    .filter((b) => !b.is_archived)
    .reduce((sum, b) => sum + toTwd(Number(b.balance), b.currency, usdToTwd), 0);

  const unrealizedPnLTwd = holdings.reduce(
    (sum, h) => sum + toTwd(h.unrealizedPnL, h.currency, usdToTwd),
    0
  );
  const realizedPnLTwd = holdings.reduce(
    (sum, h) => sum + toTwd(h.realizedPnL, h.currency, usdToTwd),
    0
  );

  return {
    stockTwd,
    cashTwd,
    totalTwd: stockTwd + cashTwd,
    unrealizedPnLTwd,
    realizedPnLTwd,
  };
}

/** 首頁趨勢圖的可選期間 */
export const RANGE_OPTIONS = [
  { key: '1m', label: '1 個月', months: 1 },
  { key: '3m', label: '3 個月', months: 3 },
  { key: '6m', label: '6 個月', months: 6 },
  { key: '1y', label: '1 年', months: 12 },
  { key: '3y', label: '3 年', months: 36 },
  { key: '5y', label: '5 年', months: 60 },
] as const;

export type RangeKey = (typeof RANGE_OPTIONS)[number]['key'];
