import { test } from 'node:test';
import assert from 'node:assert/strict';
import { officialPriceDates } from '../scripts/sync-prices.ts';

test('向交易所要正式收盤價的日子:今天往回、略過週末、新的在前', () => {
  // 2026-09-30 是星期三
  assert.deepEqual(officialPriceDates('2026-09-30'), [
    '2026-09-30',
    '2026-09-29',
    '2026-09-28',
    '2026-09-25',
    '2026-09-24',
  ]);
});

test('星期一早上那班也涵蓋上週五 —— 前日收盤價要是正式的', () => {
  const dates = officialPriceDates('2026-10-05');
  assert.equal(dates[0], '2026-10-05');
  assert.ok(dates.includes('2026-10-02'), '上週五');
  assert.ok(!dates.includes('2026-10-04') && !dates.includes('2026-10-03'), '週末不問');
});
