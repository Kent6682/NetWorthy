import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rocToIso } from '../scripts/providers.ts';

test('民國日期轉西元:證交所格式', () => {
  assert.equal(rocToIso('1150818'), '2026-08-18');
  assert.equal(rocToIso('1150101'), '2026-01-01');
  assert.equal(rocToIso('1141231'), '2025-12-31');
});

test('民國日期轉西元:含斜線的格式', () => {
  assert.equal(rocToIso('115/08/18'), '2026-08-18');
});

test('民國日期轉西元:三位數年份也要正確', () => {
  assert.equal(rocToIso('991231'), '2010-12-31');
});

test('民國日期轉西元:格式不對時回傳 null', () => {
  assert.equal(rocToIso(''), null);
  assert.equal(rocToIso('123'), null);
});
