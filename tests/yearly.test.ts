import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPriceLookup } from '../lib/pnl.ts';
import type { StockTransaction } from '../lib/holdings.ts';
import { computeYearly, sumYears, yearBoundaries } from '../lib/yearly.ts';

const o = 'u';
let seq = 0;
function tx(
  symbol: string,
  type: StockTransaction['type'],
  shares: number,
  price: number,
  fee: number,
  date: string
): StockTransaction {
  seq += 1;
  return {
    id: String(seq).padStart(4, '0'),
    owner_id: o,
    symbol,
    type,
    shares,
    price,
    fee,
    transaction_date: date,
    created_at: String(seq).padStart(4, '0'),
  };
}

const twd = () => 'TWD' as const;

test('2026 實際資料:總損益、已實現、未實現對得起來', () => {
  const txns = [
    tx('00662', 'initial', 26000, 118, 0, '2026-05-13'),
    tx('00670L', 'initial', 15000, 198.1, 0, '2026-05-13'),
    tx('00687B', 'initial', 77000, 31, 0, '2026-05-13'),
    tx('00712', 'initial', 250000, 8.94, 0, '2026-05-13'),
    tx('2542', 'initial', 23100, 42.7, 0, '2026-05-13'),
    tx('00687B', 'sell', 77000, 26.3, 2885, '2026-09-24'),
    tx('00662', 'buy', 16000, 124.4, 2836, '2026-09-24'),
  ];
  const prices = buildPriceLookup([
    { symbol: '00662', price_date: '2026-09-24', close_price: 124.25 },
    { symbol: '00670L', price_date: '2026-09-24', close_price: 211 },
    { symbol: '00687B', price_date: '2026-09-24', close_price: 26.28 },
    { symbol: '00712', price_date: '2026-09-24', close_price: 7.82 },
    { symbol: '2542', price_date: '2026-09-24', close_price: 39.5 },
  ]);

  const rows = computeYearly({
    transactions: txns,
    currencyOf: twd,
    priceOn: prices,
    usdToTwdOn: () => 32,
    today: '2026-09-28',
  });

  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.year, 2026);
  assert.equal(r.startValue, 0, '1/1 還沒有任何持股');
  assert.equal(r.endValue, 11250950, '要等於 9/24 的快照');
  assert.equal(Math.round(r.bought), 13641106, '期初持股 11,647,870 + 買進 1,993,236');
  assert.equal(r.sold, 2022215);
  assert.equal(Math.round(r.total), -367941);
  assert.equal(Math.round(r.realized), -364785);
  assert.equal(Math.round(r.unrealized), -3156, '要等於目前持股的帳面未實現');
});

test('跨年賣出:之前的帳面獲利在賣出那年從未實現搬到已實現', () => {
  // 2026 年 100 買進,年底 120;2027 年 130 賣掉
  const txns = [tx('2330', 'buy', 1, 100, 0, '2026-03-02'), tx('2330', 'sell', 1, 130, 0, '2027-05-03')];
  const prices = buildPriceLookup([
    { symbol: '2330', price_date: '2026-12-31', close_price: 120 },
    { symbol: '2330', price_date: '2027-05-03', close_price: 130 },
  ]);

  const [y2026, y2027] = computeYearly({
    transactions: txns,
    currencyOf: twd,
    priceOn: prices,
    usdToTwdOn: () => 32,
    today: '2027-06-01',
  });

  assert.deepEqual(
    [y2026.total, y2026.realized, y2026.unrealized],
    [20, 0, 20],
    '2026:還沒賣,全部是未實現'
  );
  assert.deepEqual(
    [y2027.startValue, y2027.endValue, y2027.sold],
    [120, 0, 130]
  );
  assert.equal(y2027.realized, 30, '已實現相對原始成本,跟券商對帳單一致');
  assert.equal(y2027.unrealized, -20, '年初的 +20 帳面獲利兌現了');
  assert.equal(y2027.total, 10, '2027 真正漲的只有 120 → 130');
});

test('全部統計:各年相加 = 目前帳面未實現 + 累計已實現', () => {
  const txns = [
    tx('2330', 'buy', 10, 100, 5, '2025-06-02'),
    tx('2330', 'sell', 4, 150, 3, '2026-03-02'),
    tx('2330', 'buy', 2, 140, 1, '2026-08-03'),
  ];
  const prices = buildPriceLookup([
    { symbol: '2330', price_date: '2025-12-31', close_price: 130 },
    { symbol: '2330', price_date: '2026-09-24', close_price: 160 },
  ]);

  const rows = computeYearly({
    transactions: txns,
    currencyOf: twd,
    priceOn: prices,
    usdToTwdOn: () => 32,
    today: '2026-09-28',
  });
  const all = sumYears(rows)!;

  // 目前 8 股,成本 = 6 × 100.5 + 2 × 140.5 = 884;市值 8 × 160 = 1,280
  assert.ok(Math.abs(all.unrealized - (1280 - 884)) < 1e-6, '未實現加總 = 目前帳面');
  // 賣出 4 股:600 − 3 − 4 × 100.5 = 195
  assert.ok(Math.abs(all.realized - 195) < 1e-6);
  assert.ok(Math.abs(all.total - (all.realized + all.unrealized)) < 1e-6);
  assert.equal(all.startValue, 0);
  assert.equal(all.endValue, 1280);
});

test('美股的已實現先在原幣別相減再換匯,舊年度不會被重新計價', () => {
  const txns = [
    tx('AAPL', 'buy', 10, 100, 0, '2025-03-03'),
    tx('AAPL', 'sell', 5, 110, 0, '2025-06-02'),
    tx('AAPL', 'sell', 5, 120, 0, '2026-06-01'),
  ];
  const rate = (d: string) => (d < '2026-01-01' ? 30 : 32);

  const [y2025, y2026] = computeYearly({
    transactions: txns,
    currencyOf: () => 'USD',
    priceOn: () => null,
    usdToTwdOn: rate,
    today: '2026-09-28',
  });

  assert.equal(y2025.realized, 50 * 30);
  assert.equal(y2026.realized, 100 * 32, '2025 的 +50 美元不能用 2026 的匯率再算一次');
});

test('沒有交易時沒有任何年度', () => {
  assert.deepEqual(
    computeYearly({
      transactions: [],
      currencyOf: twd,
      priceOn: () => null,
      usdToTwdOn: () => 32,
      today: '2026-09-28',
    }),
    []
  );
  assert.equal(sumYears([]), null);
});

test('查價的日子:每年的前一年底加上今天', () => {
  const txns = [tx('2330', 'buy', 1, 1, 0, '2025-06-02')];
  assert.deepEqual(yearBoundaries(txns, '2026-09-28'), ['2024-12-31', '2025-12-31', '2026-09-28']);
});

test('2026 實際資料加上今年 5 筆股利:股利算進已實現,也列出買賣與股利各多少', () => {
  const txns = [
    tx('00662', 'initial', 26000, 118, 0, '2026-05-13'),
    tx('00670L', 'initial', 15000, 198.1, 0, '2026-05-13'),
    tx('00687B', 'initial', 77000, 31, 0, '2026-05-13'),
    tx('00712', 'initial', 250000, 8.94, 0, '2026-05-13'),
    tx('2542', 'initial', 23100, 42.7, 0, '2026-05-13'),
    tx('00687B', 'dividend', 77000, 0.262, 426, '2026-06-16'),
    tx('00712', 'dividend', 250000, 0.235, 1240, '2026-06-17'),
    tx('00687B', 'dividend', 77000, 0.335, 544, '2026-09-16'),
    tx('00712', 'dividend', 250000, 0.2, 1055, '2026-09-17'),
    tx('2542', 'dividend', 23100, 4, 1950, '2026-09-23'),
    tx('00687B', 'sell', 77000, 26.3, 2885, '2026-09-24'),
    tx('00662', 'buy', 16000, 124.4, 2836, '2026-09-24'),
  ];
  const prices = buildPriceLookup([
    { symbol: '00662', price_date: '2026-09-24', close_price: 124.25 },
    { symbol: '00670L', price_date: '2026-09-24', close_price: 211 },
    { symbol: '00712', price_date: '2026-09-24', close_price: 7.82 },
    { symbol: '2542', price_date: '2026-09-24', close_price: 39.5 },
  ]);

  const [r] = computeYearly({
    transactions: txns,
    currencyOf: twd,
    priceOn: prices,
    usdToTwdOn: () => 32,
    today: '2026-09-28',
  });

  assert.equal(Math.round(r.dividends), 241904);
  assert.equal(Math.round(r.total), -126037, '−367,941 + 股利 241,904');
  assert.equal(Math.round(r.tradingRealized), -364785);
  assert.equal(Math.round(r.realized), -122881);
  assert.equal(Math.round(r.unrealized), -3156, '股利不影響未實現');
  assert.equal(Math.round(r.tax.cashGross), 247119);
  assert.equal(Math.round(r.tax.deductions), 5215);
  assert.equal(r.tax.stockPar, 0);
});

test('配股:不是買入,以面額 10 元計入股利所得', () => {
  const txns = [
    tx('2542', 'initial', 23100, 42.7, 0, '2026-05-13'),
    tx('2542', 'stock_dividend', 1155, 0, 0, '2026-09-23'),
  ];
  const [r] = computeYearly({
    transactions: txns,
    currencyOf: twd,
    priceOn: () => 40,
    usdToTwdOn: () => 32,
    today: '2026-09-28',
  });
  assert.equal(Math.round(r.bought), 986370, '配股不算買入');
  assert.equal(r.tax.stockPar, 11550);
  assert.equal(r.endValue, 24255 * 40);
});
