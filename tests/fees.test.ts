import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTwFee, twSellTaxRate } from '../lib/fees.ts';

test('買進只有手續費,無條件捨去', () => {
  // 9/24 實際那筆:16,000 × 124.4 = 1,990,400 × 0.1425% = 2,836.32
  const r = estimateTwFee('buy', '00662', 16000, 124.4, '2026-09-24');
  assert.deepEqual(r, { fee: 2836, tax: 0, total: 2836, taxLabel: '' });
});

test('賣出債券 ETF:停徵期間只有手續費', () => {
  // 9/24 實際那筆:77,000 × 26.3 = 2,025,100 × 0.1425% = 2,885.77
  const r = estimateTwFee('sell', '00687B', 77000, 26.3, '2026-09-24');
  assert.equal(r?.fee, 2885);
  assert.equal(r?.tax, 0);
  assert.equal(r?.total, 2885);
});

test('賣出一般股票:手續費加 0.3% 證交稅', () => {
  // 1,000 × 1,225 = 1,225,000 → 手續費 1,745.625 → 1,745;稅 3,675
  const r = estimateTwFee('sell', '2330', 1000, 1225, '2026-09-24');
  assert.equal(r?.fee, 1745);
  assert.equal(r?.tax, 3675);
  assert.equal(r?.total, 5420);
});

test('賣出股票型 ETF:證交稅 0.1%', () => {
  // 15,000 × 211 = 3,165,000 → 稅 3,165
  const r = estimateTwFee('sell', '00670L', 15000, 211, '2026-09-24');
  assert.equal(r?.tax, 3165);
});

test('手續費最低 20 元', () => {
  const r = estimateTwFee('buy', '2542', 10, 39.5, '2026-09-24');
  assert.equal(r?.fee, 20);
});

test('債券 ETF 停徵期過後改收 0.1%', () => {
  assert.equal(twSellTaxRate('00687B', '2026-12-31').rate, 0);
  assert.equal(twSellTaxRate('00687B', '2027-01-04').rate, 0.001);
});

test('股數或價格還沒填時不估算', () => {
  assert.equal(estimateTwFee('buy', '2330', 0, 1225, '2026-09-24'), null);
  assert.equal(estimateTwFee('buy', '2330', 1000, NaN, '2026-09-24'), null);
});
