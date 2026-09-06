/**
 * 每日盈虧的計算與月曆排版。
 *
 * 最重要的一條是「扣掉外部資金流入」—— 不扣的話,存 10 萬進銀行會被
 * 顯示成「今天賺 10 萬」。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDailyPnl,
  daysInMonth,
  monthGrid,
  monthTotal,
  parseMonth,
  previousDay,
  shiftMonth,
} from '../lib/pnl.ts';

test('盈虧就是總資產的日變化', () => {
  const totals = new Map([
    ['2026-09-01', 1000000],
    ['2026-09-02', 1020000],
    ['2026-09-03', 990000],
  ]);

  const rows = computeDailyPnl(totals, new Map(), ['2026-09-02', '2026-09-03']);

  assert.equal(rows[0].pnl, 20000);
  assert.equal(rows[1].pnl, -30000);
});

test('存款不算賺 —— 外部資金流入要扣掉', () => {
  const totals = new Map([
    ['2026-09-01', 1000000],
    ['2026-09-02', 1100000], // 總資產多了 10 萬
  ]);
  // 但那 10 萬是存進來的,不是賺的
  const flows = new Map([['2026-09-02', 100000]]);

  const rows = computeDailyPnl(totals, flows, ['2026-09-02']);
  assert.equal(rows[0].pnl, 0, '存款不該被算成盈虧');
});

test('提款不算賠', () => {
  const totals = new Map([
    ['2026-09-01', 1000000],
    ['2026-09-02', 900000],
  ]);
  const flows = new Map([['2026-09-02', -100000]]);

  assert.equal(computeDailyPnl(totals, flows, ['2026-09-02'])[0].pnl, 0);
});

test('同一天既有存款又有市值變化,兩者要分開', () => {
  const totals = new Map([
    ['2026-09-01', 1000000],
    ['2026-09-02', 1150000], // +15 萬
  ]);
  const flows = new Map([['2026-09-02', 100000]]); // 其中 10 萬是存進來的

  assert.equal(computeDailyPnl(totals, flows, ['2026-09-02'])[0].pnl, 50000);
});

test('沒有前一天可比時回 null,不要當成 0', () => {
  const totals = new Map([['2026-09-02', 1000000]]);
  const rows = computeDailyPnl(totals, new Map(), ['2026-09-02']);

  assert.equal(rows[0].pnl, null, '第一天算不出盈虧');
  assert.equal(rows[0].total, 1000000, '但總資產本身還是有');
});

test('那天沒有快照就整格空白', () => {
  const rows = computeDailyPnl(new Map(), new Map(), ['2026-09-02']);
  assert.equal(rows[0].pnl, null);
  assert.equal(rows[0].total, null);
});

test('百分比以前一日為基準;前一日為 0 時不給百分比', () => {
  const rows = computeDailyPnl(
    new Map([
      ['2026-09-01', 1000000],
      ['2026-09-02', 1020000],
    ]),
    new Map(),
    ['2026-09-02']
  );
  assert.equal(rows[0].percent, 2);

  const fromZero = computeDailyPnl(
    new Map([
      ['2026-09-01', 0],
      ['2026-09-02', 500000],
    ]),
    new Map(),
    ['2026-09-02']
  );
  assert.equal(fromZero[0].pnl, 500000);
  assert.equal(fromZero[0].percent, null, '除以 0 不該產生 Infinity');
});

test('當月合計只加算得出來的日子', () => {
  const rows = computeDailyPnl(
    new Map([
      ['2026-08-31', 1000000],
      ['2026-09-01', 1010000],
      ['2026-09-03', 1030000],
    ]),
    new Map(),
    ['2026-09-01', '2026-09-02', '2026-09-03']
  );

  // 9/2 沒有快照 → null;9/3 的前一天也沒有 → null
  assert.deepEqual(monthTotal(rows), { pnl: 10000, days: 1 });
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
