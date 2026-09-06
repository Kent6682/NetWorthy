/**
 * 首頁趨勢圖的期間選項。
 *
 * 「1 日」與「年初至今」不是固定月數,所以起算日是算出來的 ——
 * 跨月跨年是這種日期運算最容易靜靜出錯的地方。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RANGE,
  parseRange,
  rangeStartDate,
  RANGE_OPTIONS,
} from '../lib/portfolio.ts';

test('期間的順序:1 日在最前,年初至今在 1 年之前', () => {
  assert.deepEqual(
    RANGE_OPTIONS.map((r) => r.key),
    ['1d', '1m', '3m', '6m', 'ytd', '1y', '3y', '5y']
  );
});

test('預設是 1 日', () => {
  assert.equal(DEFAULT_RANGE, '1d');
  assert.equal(parseRange(undefined), '1d');
  assert.equal(parseRange('不認得的值'), '1d');
});

test('parseRange 認得每一個合法選項', () => {
  for (const opt of RANGE_OPTIONS) {
    assert.equal(parseRange(opt.key), opt.key);
  }
});

test('1 日 = 昨天,跨月跨年都要對', () => {
  assert.equal(rangeStartDate('1d', '2026-09-07'), '2026-09-06');
  assert.equal(rangeStartDate('1d', '2026-09-01'), '2026-08-31', '跨月');
  assert.equal(rangeStartDate('1d', '2026-01-01'), '2025-12-31', '跨年');
  assert.equal(rangeStartDate('1d', '2026-03-01'), '2026-02-28', '2026 不是閏年');
});

test('年初至今 = 當年的一月一號', () => {
  assert.equal(rangeStartDate('ytd', '2026-09-07'), '2026-01-01');
  assert.equal(rangeStartDate('ytd', '2026-01-01'), '2026-01-01', '元旦當天也成立');
  assert.equal(rangeStartDate('ytd', '2026-12-31'), '2026-01-01');
});

test('固定月數的期間往回推正確的月份', () => {
  assert.equal(rangeStartDate('1m', '2026-09-07'), '2026-08-07');
  assert.equal(rangeStartDate('3m', '2026-09-07'), '2026-06-07');
  assert.equal(rangeStartDate('6m', '2026-09-07'), '2026-03-07');
  assert.equal(rangeStartDate('1y', '2026-09-07'), '2025-09-07');
  assert.equal(rangeStartDate('3y', '2026-09-07'), '2023-09-07');
  assert.equal(rangeStartDate('5y', '2026-09-07'), '2021-09-07');
});

test('基準日只看傳進來的字串,不讀系統時鐘', () => {
  // 伺服器跑在哪一時區都要算出同樣的結果
  assert.equal(rangeStartDate('ytd', '2024-06-15'), '2024-01-01');
  assert.equal(rangeStartDate('1y', '2024-06-15'), '2023-06-15');
});
