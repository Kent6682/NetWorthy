import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StockTransaction } from '../lib/holdings.ts';
import { dividendSuggestions, stockDividendShares, type CorporateAction } from '../lib/dividends.ts';

let seq = 0;
function t(partial: Partial<StockTransaction>): StockTransaction {
  seq += 1;
  return {
    id: String(seq).padStart(4, '0'),
    owner_id: 'kent',
    symbol: '00712',
    type: 'initial',
    shares: 250000,
    price: 8.94,
    fee: 0,
    transaction_date: '2026-05-13',
    created_at: String(seq).padStart(4, '0'),
    ...partial,
  };
}

const action = (partial: Partial<CorporateAction>): CorporateAction => ({
  market: 'TW',
  symbol: '00712',
  ex_date: '2026-12-17',
  cash_dividend: 0.19,
  stock_ratio: null,
  ...partial,
});

test('除息日前一天收盤有持股、還沒記錄 → 提示,金額與二代健保都算好', () => {
  const [s] = dividendSuggestions([t({})], [action({})], [], '2026-12-17');
  assert.equal(s.kind, 'dividend');
  assert.equal(s.shares, 250000);
  assert.equal(s.gross, 47500);
  assert.equal(s.deduction, 1002, '47,500 × 2.11% = 1,002.25');
});

test('除息日還沒到不提示', () => {
  assert.equal(dividendSuggestions([t({})], [action({})], [], '2026-12-16').length, 0);
});

test('金額還沒公布不提示', () => {
  assert.equal(dividendSuggestions([t({})], [action({ cash_dividend: null })], [], '2026-12-17').length, 0);
});

test('除息日當天才買進的領不到;除息日當天賣掉的照樣領得到', () => {
  const boughtOnExDate = [t({ symbol: '2330', type: 'buy', shares: 1000, price: 1000, transaction_date: '2026-12-17' })];
  assert.equal(
    dividendSuggestions(boughtOnExDate, [action({ symbol: '2330' })], [], '2026-12-20').length,
    0
  );

  const soldOnExDate = [t({}), t({ type: 'sell', shares: 250000, price: 7.9, transaction_date: '2026-12-17' })];
  const [s] = dividendSuggestions(soldOnExDate, [action({})], [], '2026-12-20');
  assert.equal(s?.shares, 250000);
});

test('除息日之前就賣光的不提示', () => {
  const txns = [t({}), t({ type: 'sell', shares: 250000, price: 7.9, transaction_date: '2026-12-10' })];
  assert.equal(dividendSuggestions(txns, [action({})], [], '2026-12-20').length, 0);
});

test('已經記錄過、或按了略過的不再提示', () => {
  const recorded = [t({}), t({ type: 'dividend', price: 0.19, fee: 1002, transaction_date: '2026-12-17' })];
  assert.equal(dividendSuggestions(recorded, [action({})], [], '2026-12-20').length, 0);

  const dismissed = [{ symbol: '00712', ex_date: '2026-12-17', kind: 'dividend' as const }];
  assert.equal(dividendSuggestions([t({})], [action({})], dismissed, '2026-12-20').length, 0);
});

test('同時配息又配股:兩筆提示,配股數以四捨五入後的配股率計算', () => {
  // 1235 的真實公告:現金 0.5、配股率 0.04999999(每千股 50 股)
  const txns = [t({ symbol: '1235', shares: 23100, price: 40 })];
  const out = dividendSuggestions(
    txns,
    [action({ symbol: '1235', cash_dividend: 0.5, stock_ratio: 0.04999999 })],
    [],
    '2026-12-20'
  );
  const cash = out.find((s) => s.kind === 'dividend');
  const stock = out.find((s) => s.kind === 'stock_dividend');
  assert.equal(cash?.gross, 11550);
  assert.equal(cash?.deduction, 0, '未滿 2 萬元不扣二代健保');
  assert.equal(stock?.shares, 1155, '不能因為 0.04999999 算成 1,154');
});

test('配股數不足一股時捨去', () => {
  assert.equal(stockDividendShares(19, 0.05), 0);
  assert.equal(stockDividendShares(23100, 0.04999999), 1155);
  assert.equal(stockDividendShares(1000, 0.00999999), 10);
});
