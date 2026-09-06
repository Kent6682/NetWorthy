/**
 * 每日盈虧的計算與月曆排版。
 *
 * 公式:股票市值變化 − 當日買進金額 + 當日賣出金額 − 當日手續費與稅
 *
 * 最重要的一條是「扣掉買賣造成的部位變動」—— 不扣的話,買進 50 萬會被
 * 顯示成「今天賺 50 萬」。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPriceLookup,
  computeDailyPnl,
  computeHoldingPnl,
  daysInMonth,
  groupTradesByDate,
  monthGrid,
  monthTotal,
  parseDay,
  parseMonth,
  previousDay,
  shiftMonth,
  type TradeRow,
} from '../lib/pnl.ts';
import type { StockTransaction } from '../lib/holdings.ts';

function trade(partial: Partial<TradeRow>): TradeRow {
  return {
    type: 'buy',
    symbol: '2330',
    shares: 1000,
    price: 500,
    fee: 0,
    transaction_date: '2026-09-02',
    ...partial,
  };
}

const noTrades = new Map();

test('沒有交易的日子,盈虧就是股票市值的變化', () => {
  const stock = new Map([
    ['2026-09-01', 1000000],
    ['2026-09-02', 1020000],
    ['2026-09-03', 990000],
  ]);

  const rows = computeDailyPnl(stock, noTrades, ['2026-09-02', '2026-09-03']);
  assert.equal(rows[0].pnl, 20000);
  assert.equal(rows[1].pnl, -30000);
});

test('買進不算賺 —— 只有手續費算成當天的損失', () => {
  // 市值多了 50 萬,但那是拿現金換來的
  const stock = new Map([
    ['2026-09-01', 1000000],
    ['2026-09-02', 1500000],
  ]);
  const trades = groupTradesByDate([
    trade({ type: 'buy', shares: 1000, price: 500, fee: 500 }),
  ]);

  assert.equal(computeDailyPnl(stock, trades, ['2026-09-02'])[0].pnl, -500);
});

test('賣出不算賠 —— 只有費稅算成當天的損失', () => {
  const stock = new Map([
    ['2026-09-01', 1500000],
    ['2026-09-02', 1000000],
  ]);
  const trades = groupTradesByDate([
    trade({ type: 'sell', shares: 1000, price: 500, fee: 1500 }),
  ]);

  assert.equal(computeDailyPnl(stock, trades, ['2026-09-02'])[0].pnl, -1500);
});

test('有沒有勾選連動券商帳戶都算得對', () => {
  /*
   * 這是改用股票市值當基準的主要理由。
   * 舊的總資產公式在「沒勾選連動」時會憑空多出 50 萬 —— 股票增加了、
   * 現金卻沒減少。改看股票市值之後,現金那邊根本不參與,兩種情況一致。
   */
  const stock = new Map([
    ['2026-09-01', 1000000],
    ['2026-09-02', 1500000],
  ]);
  const trades = groupTradesByDate([
    trade({ type: 'buy', shares: 1000, price: 500, fee: 500 }),
  ]);

  assert.equal(computeDailyPnl(stock, trades, ['2026-09-02'])[0].pnl, -500);
});

test('同一天既有買賣又有市場波動,兩者要分開', () => {
  // 市值 +53 萬,其中 50 萬是買進帶進來的,真正漲的是 3 萬
  const stock = new Map([
    ['2026-09-01', 1000000],
    ['2026-09-02', 1530000],
  ]);
  const trades = groupTradesByDate([
    trade({ type: 'buy', shares: 1000, price: 500, fee: 500 }),
  ]);

  assert.equal(computeDailyPnl(stock, trades, ['2026-09-02'])[0].pnl, 29500);
});

test('導入既有持股那天不計盈虧', () => {
  const stock = new Map([
    ['2026-05-12', 0],
    ['2026-05-13', 11500000],
  ]);
  const trades = groupTradesByDate([
    trade({ type: 'initial', transaction_date: '2026-05-13' }),
  ]);

  const row = computeDailyPnl(stock, trades, ['2026-05-13'])[0];
  assert.equal(row.pnl, null, '導入不是賺,不該顯示成暴賺 1,150 萬');
  assert.equal(row.trades?.initial, 1, '但要標記那天有導入');
});

test('沒有前一天可比時回 null,不要當成 0', () => {
  const rows = computeDailyPnl(new Map([['2026-09-02', 1000000]]), noTrades, ['2026-09-02']);
  assert.equal(rows[0].pnl, null);
  assert.equal(rows[0].stock, 1000000, '但市值本身還是有');
});

test('那天沒有快照就整格空白', () => {
  const rows = computeDailyPnl(new Map(), noTrades, ['2026-09-02']);
  assert.equal(rows[0].pnl, null);
  assert.equal(rows[0].stock, null);
});

test('百分比以前一日市值為基準;前一日為 0 時不給百分比', () => {
  const rows = computeDailyPnl(
    new Map([
      ['2026-09-01', 1000000],
      ['2026-09-02', 1020000],
    ]),
    noTrades,
    ['2026-09-02']
  );
  assert.equal(rows[0].percent, 2);

  const fromZero = computeDailyPnl(
    new Map([
      ['2026-09-01', 0],
      ['2026-09-02', 500000],
    ]),
    noTrades,
    ['2026-09-02']
  );
  assert.equal(fromZero[0].percent, null, '除以 0 不該產生 Infinity');
});

test('groupTradesByDate 依日期分組並累計部位變動', () => {
  const grouped = groupTradesByDate([
    trade({ type: 'buy', shares: 1000, price: 500, fee: 500, transaction_date: '2026-09-02' }),
    trade({ type: 'buy', shares: 500, price: 400, fee: 200, transaction_date: '2026-09-02' }),
    trade({ type: 'sell', shares: 200, price: 600, fee: 300, transaction_date: '2026-09-02' }),
    trade({ type: 'buy', transaction_date: '2026-09-05' }),
  ]);

  const day = grouped.get('2026-09-02')!;
  assert.equal(day.buy, 2);
  assert.equal(day.sell, 1);
  // 買 (500,000+500) + 買 (200,000+200) − 賣 (120,000−300) = 581,000
  assert.equal(day.adjustment, 581000);
  assert.equal(grouped.get('2026-09-05')?.buy, 1);
  assert.equal(grouped.has('2026-09-03'), false);
});

test('導入不列入部位變動金額(那天本來就不計盈虧)', () => {
  const grouped = groupTradesByDate([trade({ type: 'initial', shares: 1000, price: 500 })]);
  const day = grouped.get('2026-09-02')!;

  assert.equal(day.initial, 1);
  assert.equal(day.adjustment, 0);
});

test('當月合計只加算得出來的日子', () => {
  const rows = computeDailyPnl(
    new Map([
      ['2026-08-31', 1000000],
      ['2026-09-01', 1010000],
      ['2026-09-03', 1030000],
    ]),
    noTrades,
    ['2026-09-01', '2026-09-02', '2026-09-03']
  );

  // 9/2 沒有快照 → null;9/3 的前一天也沒有 → null
  assert.deepEqual(monthTotal(rows), { pnl: 10000, days: 1 });
});

// --- 單日明細 ------------------------------------------------------------

function stockTxn(partial: Partial<StockTransaction>): StockTransaction {
  return {
    id: partial.id ?? 't1',
    owner_id: 'kent',
    symbol: '2330',
    type: 'initial',
    shares: 1000,
    price: 500,
    fee: 0,
    transaction_date: '2026-09-01',
    created_at: '2026-09-01T00:00:00Z',
    ...partial,
  };
}

test('buildPriceLookup:查不到當天就沿用最近一次收盤價', () => {
  const at = buildPriceLookup([
    { symbol: '2330', price_date: '2026-09-04', close_price: 610 },
    { symbol: '2330', price_date: '2026-09-01', close_price: 600 },
  ]);

  assert.equal(at('2330', '2026-09-04'), 610);
  assert.equal(at('2330', '2026-09-06'), 610, '週日沿用週五');
  assert.equal(at('2330', '2026-09-02'), 600, '沒開盤沿用前一個交易日');
  assert.equal(at('2330', '2026-08-31'), null, '第一筆之前不要往回猜');
  assert.equal(at('9999', '2026-09-04'), null, '沒有這檔');
});

test('每檔明細加總 = 日曆格子的當日盈虧', () => {
  /*
   * 這是點進去看明細時最基本的信任:兩個數字必須一致。
   * 兩邊都用 lib/holdings.ts 算持股、同樣的缺價退回成本價、同樣的交易扣除。
   */
  const txns = [
    stockTxn({ id: 'a', symbol: '2330', shares: 1000, price: 500 }),
    stockTxn({ id: 'b', symbol: '0050', shares: 2000, price: 150 }),
  ];
  const at = buildPriceLookup([
    { symbol: '2330', price_date: '2026-09-02', close_price: 500 },
    { symbol: '2330', price_date: '2026-09-03', close_price: 520 },
    { symbol: '0050', price_date: '2026-09-02', close_price: 150 },
    { symbol: '0050', price_date: '2026-09-03', close_price: 148 },
  ]);

  const holdings = computeHoldingPnl(txns, '2026-09-03', at);
  const sum = holdings.reduce((s, h) => s + (h.pnl ?? 0), 0);

  // 用同一組市值餵給日曆的公式
  const stock = new Map([
    ['2026-09-02', 1000 * 500 + 2000 * 150],
    ['2026-09-03', 1000 * 520 + 2000 * 148],
  ]);
  const dayPnl = computeDailyPnl(stock, noTrades, ['2026-09-03'])[0].pnl;

  assert.equal(sum, 16000, '2330 +20,000、0050 −4,000');
  assert.equal(sum, dayPnl, '明細加總必須等於日曆格子');
});

test('明細依影響大小排序,買賣當天扣掉部位變動', () => {
  const txns = [
    stockTxn({ id: 'a', symbol: '2330', shares: 1000, price: 500 }),
    stockTxn({
      id: 'b',
      symbol: '2330',
      type: 'buy',
      shares: 1000,
      price: 510,
      fee: 700,
      transaction_date: '2026-09-03',
      created_at: '2026-09-03T00:00:00Z',
    }),
    stockTxn({ id: 'c', symbol: '0050', shares: 2000, price: 150 }),
  ];
  const at = buildPriceLookup([
    { symbol: '2330', price_date: '2026-09-02', close_price: 500 },
    { symbol: '2330', price_date: '2026-09-03', close_price: 520 },
    { symbol: '0050', price_date: '2026-09-02', close_price: 150 },
    { symbol: '0050', price_date: '2026-09-03', close_price: 149 },
  ]);

  const rows = computeHoldingPnl(txns, '2026-09-03', at);
  const tsmc = rows.find((r) => r.symbol === '2330')!;

  // 原有 1000 股漲 20 = +20,000;新買的 1000 股從 510 收在 520 = +10,000;手續費 −700
  assert.equal(tsmc.pnl, 29300);
  assert.equal(tsmc.shares, 2000);
  assert.equal(tsmc.prevShares, 1000);
  assert.equal(tsmc.trades.length, 1);
  assert.equal(rows[0].symbol, '2330', '影響最大的排前面');
});

test('每檔的漲跌幅以前一日市值為基準', () => {
  const txns = [stockTxn({ symbol: '2330', shares: 1000, price: 500 })];
  const at = buildPriceLookup([
    { symbol: '2330', price_date: '2026-09-02', close_price: 500 },
    { symbol: '2330', price_date: '2026-09-03', close_price: 520 },
  ]);

  const row = computeHoldingPnl(txns, '2026-09-03', at)[0];
  assert.equal(row.pnl, 20000);
  assert.equal(row.percent, 4, '20,000 ÷ 500,000');
});

test('當天才建立的部位沒有前一日,不給漲跌幅', () => {
  const txns = [
    stockTxn({
      symbol: '2330',
      type: 'buy',
      shares: 1000,
      price: 500,
      transaction_date: '2026-09-03',
      created_at: '2026-09-03T00:00:00Z',
    }),
  ];
  const at = buildPriceLookup([{ symbol: '2330', price_date: '2026-09-03', close_price: 520 }]);

  const row = computeHoldingPnl(txns, '2026-09-03', at)[0];
  assert.equal(row.prevShares, 0);
  assert.equal(row.pnl, 20000, '從成交價 500 收在 520');
  assert.equal(row.percent, null, '除以 0 不該產生 Infinity');
});

test('導入當天那一檔不給盈虧', () => {
  const txns = [stockTxn({ symbol: '2330', transaction_date: '2026-09-03' })];
  const at = buildPriceLookup([{ symbol: '2330', price_date: '2026-09-03', close_price: 520 }]);

  const row = computeHoldingPnl(txns, '2026-09-03', at)[0];
  assert.equal(row.pnl, null, '導入不是賺 52 萬');
  assert.equal(row.shares, 1000);
});

test('當天賣光的標的仍要列出來(它那天有貢獻盈虧)', () => {
  const txns = [
    stockTxn({ id: 'a', symbol: '2330', shares: 1000, price: 500 }),
    stockTxn({
      id: 'b',
      symbol: '2330',
      type: 'sell',
      shares: 1000,
      price: 520,
      fee: 1500,
      transaction_date: '2026-09-03',
      created_at: '2026-09-03T00:00:00Z',
    }),
  ];
  const at = buildPriceLookup([
    { symbol: '2330', price_date: '2026-09-02', close_price: 500 },
    { symbol: '2330', price_date: '2026-09-03', close_price: 520 },
  ]);

  const rows = computeHoldingPnl(txns, '2026-09-03', at);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].shares, 0, '賣光了');
  assert.equal(rows[0].prevShares, 1000);
  // 0 − 500,000 − (−(520,000 − 1,500)) = 18,500
  assert.equal(rows[0].pnl, 18500);
});

test('沒有持股過的標的不列', () => {
  const txns = [
    stockTxn({ id: 'a', symbol: '2330', transaction_date: '2026-09-10' }), // 之後才買
  ];
  const at = buildPriceLookup([]);
  assert.deepEqual(computeHoldingPnl(txns, '2026-09-03', at), []);
});

test('parseDay 只接受屬於這個月的合法日期', () => {
  assert.equal(parseDay('2026-09-04', '2026-09'), '2026-09-04');
  assert.equal(parseDay('2026-08-04', '2026-09'), undefined, '不是這個月');
  assert.equal(parseDay('2026-09-31', '2026-09'), undefined, '九月沒有 31 號');
  assert.equal(parseDay('abc', '2026-09'), undefined);
  assert.equal(parseDay(undefined, '2026-09'), undefined);
});

test('previousDay 跨月跨年正確', () => {
  assert.equal(previousDay('2026-09-01'), '2026-08-31');
  assert.equal(previousDay('2026-01-01'), '2025-12-31');
  assert.equal(previousDay('2026-03-01'), '2026-02-28', '2026 不是閏年');
});

test('daysInMonth 天數正確', () => {
  assert.equal(daysInMonth('2026-09').length, 30);
  assert.equal(daysInMonth('2026-02').length, 28);
  assert.equal(daysInMonth('2024-02').length, 29, '2024 是閏年');
  assert.equal(daysInMonth('2026-01')[0], '2026-01-01');
});

test('monthGrid 每列 7 格,月初補空對齊星期', () => {
  // 2026-09-01 是星期二 → 前面補 2 格
  const weeks = monthGrid('2026-09');

  assert.ok(weeks.every((w) => w.length === 7), '每列都要剛好 7 格');
  assert.deepEqual(weeks[0].slice(0, 2), [null, null]);
  assert.equal(weeks[0][2], '2026-09-01');
  assert.equal(weeks.flat().filter((d) => d !== null).length, 30);
});

test('shiftMonth 跨年正確', () => {
  assert.equal(shiftMonth('2026-09', 1), '2026-10');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('parseMonth 擋掉不合法的輸入', () => {
  assert.equal(parseMonth('2026-09', '2026-01'), '2026-09');
  assert.equal(parseMonth('2026-13', '2026-01'), '2026-01', '沒有 13 月');
  assert.equal(parseMonth('2026-00', '2026-01'), '2026-01');
  assert.equal(parseMonth('abc', '2026-01'), '2026-01');
  assert.equal(parseMonth(undefined, '2026-01'), '2026-01');
});
