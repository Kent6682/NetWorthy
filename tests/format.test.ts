import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatNumberInput, parseNumberInput } from '../lib/format.ts';

test('輸入框千分位:整數加逗號', () => {
  assert.equal(formatNumberInput('16000'), '16,000');
  assert.equal(formatNumberInput('250000'), '250,000');
  assert.equal(formatNumberInput('999'), '999');
});

test('輸入框千分位:已經有逗號的重新排', () => {
  // 刪掉一個數字後逗號位置要跟著變
  assert.equal(formatNumberInput('16,00'), '1,600');
});

test('輸入框千分位:打到一半的小數點要留著', () => {
  assert.equal(formatNumberInput('2836.'), '2,836.');
  assert.equal(formatNumberInput('1234.5'), '1,234.5');
  assert.equal(formatNumberInput('.5'), '0.5');
});

test('輸入框千分位:小數位數有上限,多的小數點丟掉', () => {
  assert.equal(formatNumberInput('1.23456', 4), '1.2345');
  assert.equal(formatNumberInput('1.2.3', 4), '1.23');
  assert.equal(formatNumberInput('12.5', 0), '12');
});

test('輸入框千分位:非數字字元與開頭的 0 拿掉', () => {
  assert.equal(formatNumberInput('abc1x2'), '12');
  assert.equal(formatNumberInput('007'), '7');
  assert.equal(formatNumberInput('0'), '0');
  assert.equal(formatNumberInput(''), '');
});

test('解析千分位輸入', () => {
  assert.equal(parseNumberInput('16,000'), 16000);
  assert.equal(parseNumberInput('2,836.5'), 2836.5);
  assert.ok(Number.isNaN(parseNumberInput('')));
});
