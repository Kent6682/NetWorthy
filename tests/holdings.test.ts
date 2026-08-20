import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateHolding,
  calculateHoldings,
  mergeHoldingsBySymbol,
  type StockTransaction,
} from '../lib/holdings.ts';

let seq = 0;
function txn(partial: Partial<StockTransaction>): StockTransaction {
  seq += 1;
  return {
    id: String(seq).padStart(4, '0'),
    owner_id: 'kent',
    symbol: '2330',
    type: 'buy',
    shares: 1000,
    price: 600,
    fee: 0,
    transaction_date: '2026-01-01',
    created_at: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`,
    ...partial,
  };
}

test('期初持股:直接採用輸入的股數與均價', () => {
  const h = calculateHolding([
    txn({ type: 'initial', shares: 2000, price: 550, transaction_date: '2026-01-01' }),
  ]);
  assert.equal(h?.shares, 2000);
  assert.equal(h?.avgCost, 550);
  assert.equal(h?.totalCost, 1_100_000);
  assert.equal(h?.realizedPnL, 0);
});

test('買進:重新計算加權平均價', () => {
  // 2000 股 @ 550 → 再買 1000 股 @ 700
  // 均價 = (2000×550 + 1000×700) ÷ 3000 = 1,800,000 ÷ 3000 = 600
  const h = calculateHolding([
    txn({ type: 'initial', shares: 2000, price: 550, transaction_date: '2026-01-01' }),
    txn({ type: 'buy', shares: 1000, price: 700, transaction_date: '2026-02-01' }),
  ]);
  assert.equal(h?.shares, 3000);
  assert.equal(h?.avgCost, 600);
  assert.equal(h?.totalCost, 1_800_000);
});

test('買進手續費計入成本', () => {
  // (1000×600 + 855) ÷ 1000 = 600.855
  const h = calculateHolding([
    txn({ type: 'buy', shares: 1000, price: 600, fee: 855, transaction_date: '2026-01-05' }),
  ]);
  assert.equal(h?.avgCost, 600.855);
  assert.equal(h?.totalCost, 600_855);
});

test('賣出:均價不變,持股與總成本按均價等比減少', () => {
  const h = calculateHolding([
    txn({ type: 'initial', shares: 3000, price: 600, transaction_date: '2026-01-01' }),
    txn({ type: 'sell', shares: 1000, price: 700, transaction_date: '2026-03-01' }),
  ]);
  assert.equal(h?.shares, 2000);
  assert.equal(h?.avgCost, 600, '賣出後均價必須維持 600');
  assert.equal(h?.totalCost, 1_200_000);
  // 已實現損益 = 1000×700 − 1000×600 = 100,000
  assert.equal(h?.realizedPnL, 100_000);
});

test('賣出手續費從賣出價金扣除', () => {
  const h = calculateHolding([
    txn({ type: 'initial', shares: 1000, price: 600, transaction_date: '2026-01-01' }),
    txn({ type: 'sell', shares: 500, price: 700, fee: 1500, transaction_date: '2026-03-01' }),
  ]);
  // (500×700 − 1500) − 500×600 = 348,500 − 300,000 = 48,500
  assert.equal(h?.realizedPnL, 48_500);
  assert.equal(h?.avgCost, 600);
});

test('全數賣出後歸零', () => {
  const h = calculateHolding([
    txn({ type: 'initial', shares: 1000, price: 600, transaction_date: '2026-01-01' }),
    txn({ type: 'sell', shares: 1000, price: 650, transaction_date: '2026-03-01' }),
  ]);
  assert.equal(h?.shares, 0);
  assert.equal(h?.totalCost, 0);
  assert.equal(h?.avgCost, 0);
  assert.equal(h?.realizedPnL, 50_000);
});

test('賣光後重新買進,均價以新買進價為準', () => {
  const h = calculateHolding([
    txn({ type: 'initial', shares: 1000, price: 600, transaction_date: '2026-01-01' }),
    txn({ type: 'sell', shares: 1000, price: 650, transaction_date: '2026-03-01' }),
    txn({ type: 'buy', shares: 500, price: 800, transaction_date: '2026-04-01' }),
  ]);
  assert.equal(h?.shares, 500);
  assert.equal(h?.avgCost, 800);
  assert.equal(h?.realizedPnL, 50_000, '已實現損益要保留');
});

test('買賣交錯:順序會影響均價,依交易日排序計算', () => {
  // 故意用亂序傳入,結果必須跟按日期排序一致
  const ordered = calculateHolding([
    txn({ type: 'buy', shares: 1000, price: 500, transaction_date: '2026-01-01' }),
    txn({ type: 'buy', shares: 1000, price: 700, transaction_date: '2026-02-01' }),
    txn({ type: 'sell', shares: 500, price: 900, transaction_date: '2026-03-01' }),
  ]);
  const shuffled = calculateHolding([
    txn({ type: 'sell', shares: 500, price: 900, transaction_date: '2026-03-01' }),
    txn({ type: 'buy', shares: 1000, price: 700, transaction_date: '2026-02-01' }),
    txn({ type: 'buy', shares: 1000, price: 500, transaction_date: '2026-01-01' }),
  ]);
  assert.equal(ordered?.avgCost, 600);
  assert.equal(ordered?.shares, 1500);
  assert.deepEqual(
    { s: shuffled?.shares, a: shuffled?.avgCost },
    { s: ordered?.shares, a: ordered?.avgCost },
    '亂序輸入的計算結果必須一致'
  );
});

test('同一天的期初持股永遠排在買賣之前', () => {
  const h = calculateHolding([
    txn({ type: 'buy', shares: 1000, price: 700, transaction_date: '2026-01-01' }),
    txn({ type: 'initial', shares: 1000, price: 500, transaction_date: '2026-01-01' }),
  ]);
  // 期初 1000@500 先,再買 1000@700 → 均價 600
  assert.equal(h?.avgCost, 600);
  assert.equal(h?.shares, 2000);
});

test('賣超時以實際持股為上限,不會出現負股數', () => {
  const h = calculateHolding([
    txn({ type: 'initial', shares: 500, price: 600, transaction_date: '2026-01-01' }),
    txn({ type: 'sell', shares: 900, price: 700, transaction_date: '2026-02-01' }),
  ]);
  assert.equal(h?.shares, 0);
  assert.equal(h?.realizedPnL, 50_000, '只結算實際持有的 500 股');
});

test('多人多檔:依持有人與代號分組', () => {
  const holdings = calculateHoldings([
    txn({ owner_id: 'kent', symbol: '2330', type: 'initial', shares: 1000, price: 600 }),
    txn({ owner_id: 'kent', symbol: 'AAPL', type: 'initial', shares: 50, price: 190 }),
    txn({ owner_id: 'wife', symbol: '2330', type: 'initial', shares: 2000, price: 500 }),
  ]);
  assert.equal(holdings.length, 3);
  const kentTsmc = holdings.find((h) => h.ownerId === 'kent' && h.symbol === '2330');
  const wifeTsmc = holdings.find((h) => h.ownerId === 'wife' && h.symbol === '2330');
  assert.equal(kentTsmc?.avgCost, 600);
  assert.equal(wifeTsmc?.avgCost, 500);
});

test('全家視角:同一檔合併後仍是加權平均', () => {
  const merged = mergeHoldingsBySymbol(
    calculateHoldings([
      txn({ owner_id: 'kent', symbol: '2330', type: 'initial', shares: 1000, price: 600 }),
      txn({ owner_id: 'wife', symbol: '2330', type: 'initial', shares: 3000, price: 500 }),
    ])
  );
  assert.equal(merged.length, 1);
  // (1000×600 + 3000×500) ÷ 4000 = 2,100,000 ÷ 4000 = 525
  assert.equal(merged[0].shares, 4000);
  assert.equal(merged[0].avgCost, 525);
});

test('零股(小數股數)計算正確', () => {
  const h = calculateHolding([
    txn({ type: 'buy', shares: 13.5, price: 1000, transaction_date: '2026-01-01' }),
    txn({ type: 'buy', shares: 6.5, price: 1200, transaction_date: '2026-02-01' }),
  ]);
  // (13.5×1000 + 6.5×1200) ÷ 20 = (13500 + 7800) ÷ 20 = 1065
  assert.equal(h?.shares, 20);
  assert.equal(h?.avgCost, 1065);
});

test('沒有交易紀錄時回傳 null', () => {
  assert.equal(calculateHolding([]), null);
});
