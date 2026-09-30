import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateDividendDeduction, estimateTwFee, twSellTaxRate } from '../lib/fees.ts';

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

test('現金股利:2 萬元以上扣二代健保 2.11%,四捨五入到元', () => {
  // 00712 6/17:250,000 × 0.235 = 58,750 → 1,239.625 → 1,240
  assert.deepEqual(estimateDividendDeduction('TW', 58750), { amount: 1240, label: '二代健保 2.11%' });
  assert.equal(estimateDividendDeduction('TW', 92400)?.amount, 1950);
  assert.equal(estimateDividendDeduction('TW', 20000)?.amount, 422, '剛好 2 萬也要扣');
});

test('現金股利:未滿 2 萬元不扣', () => {
  assert.equal(estimateDividendDeduction('TW', 19999)?.amount, 0);
});

test('美股股利:預扣 30%', () => {
  assert.equal(estimateDividendDeduction('US', 26.25)?.amount, 7.88);
});

test('股數或每股配息還沒填時不估算', () => {
  assert.equal(estimateDividendDeduction('TW', 0), null);
  assert.equal(estimateDividendDeduction('TW', NaN), null);
});
