import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildValuedHoldings, computeRealizedTwd, computeTotals } from '../lib/portfolio.ts';
import type { StockTransaction } from '../lib/holdings.ts';
import type { Stock } from '../lib/types.ts';

const owner = 'u';

// 9/24 實際那筆:00687B 期初 77,000 股 @ 31,全部以 26.3 賣出,費用 2,885
const txns: StockTransaction[] = [
  { id: 'a', owner_id: owner, symbol: '00687B', type: 'initial', shares: 77000, price: 31, fee: 0, transaction_date: '2026-05-13' },
  { id: 'b', owner_id: owner, symbol: '00687B', type: 'sell', shares: 77000, price: 26.3, fee: 2885, transaction_date: '2026-09-24' },
  { id: 'c', owner_id: owner, symbol: '2542', type: 'initial', shares: 23100, price: 42.7, fee: 0, transaction_date: '2026-05-13' },
];

const stocks = [
  { symbol: '00687B', market: 'TW', name: null, currency: 'TWD' },
  { symbol: '2542', market: 'TW', name: null, currency: 'TWD' },
] as Stock[];

test('全部賣光的標的,已實現損益仍要算進合計', () => {
  const holdings = buildValuedHoldings(txns, stocks, [], 32);

  assert.deepEqual(
    holdings.map((h) => h.symbol),
    ['2542'],
    '持股清單只列還有股數的'
  );

  const realized = computeRealizedTwd(txns, stocks, 32);
  // 2,025,100 − 2,885 − 2,387,000
  assert.equal(realized, -364785);

  const totals = computeTotals(holdings, [], 32, realized);
  assert.equal(totals.realizedPnLTwd, -364785, '不能因為 00687B 已經賣光就變成 0');
});

test('美股的已實現損益要換算台幣', () => {
  const us: StockTransaction[] = [
    { id: 'x', owner_id: owner, symbol: 'AAPL', type: 'buy', shares: 10, price: 100, fee: 0, transaction_date: '2026-01-02' },
    { id: 'y', owner_id: owner, symbol: 'AAPL', type: 'sell', shares: 10, price: 110, fee: 0, transaction_date: '2026-02-02' },
  ];
  const usStocks = [{ symbol: 'AAPL', market: 'US', name: null, currency: 'USD' }] as Stock[];

  assert.equal(computeRealizedTwd(us, usStocks, 32), 3200);
});
