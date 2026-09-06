/**
 * 每日快照的計算 —— 每日同步與歷史回填共用這一份,所以行為必須釘死。
 * 重點在「依日期取捨」:回填就是靠這個算出過去每一天的資產。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  carryForward,
  computeSnapshotRows,
  eachDay,
  type SnapshotSources,
} from '../lib/snapshots.ts';
import type { StockTransaction } from '../lib/holdings.ts';

const KENT = '11111111-1111-1111-1111-111111111111';
const WIFE = '22222222-2222-2222-2222-222222222222';
const HOME = '99999999-9999-9999-9999-999999999999';

function stockTxn(partial: Partial<StockTransaction>): StockTransaction {
  return {
    id: partial.id ?? 's1',
    owner_id: KENT,
    symbol: '2330',
    type: 'initial',
    shares: 1000,
    price: 600,
    fee: 0,
    transaction_date: '2026-05-13',
    created_at: '2026-05-13T00:00:00Z',
    ...partial,
  };
}

function sources(over: Partial<SnapshotSources> = {}): SnapshotSources {
  return {
    profiles: [{ id: KENT, household_id: HOME }],
    accounts: [],
    accountTxns: [],
    stockTxns: [],
    currencyBySymbol: new Map([['2330', 'TWD']]),
    ...over,
  };
}

const noPrice = () => null;

test('持有起始日當天就算進資產,前一天不算', () => {
  const s = sources({ stockTxns: [stockTxn({})] });

  const before = computeSnapshotRows(s, '2026-05-12', () => 700, 1);
  const onDay = computeSnapshotRows(s, '2026-05-13', () => 700, 1);

  assert.equal(before[0].stock_twd, 0, '起始日之前不該有資產');
  assert.equal(onDay[0].stock_twd, 700000, '起始日當天就以當天收盤價計入');
});

test('用的是那一天的收盤價,不是最新價', () => {
  const s = sources({ stockTxns: [stockTxn({})] });

  assert.equal(computeSnapshotRows(s, '2026-06-01', () => 650, 1)[0].stock_twd, 650000);
  assert.equal(computeSnapshotRows(s, '2026-07-01', () => 810, 1)[0].stock_twd, 810000);
});

test('沒有那天的報價時退回成本價,不會變成 0', () => {
  const s = sources({ stockTxns: [stockTxn({})] });
  const rows = computeSnapshotRows(s, '2026-06-01', noPrice, 1);

  assert.equal(rows[0].stock_twd, 600000, '1000 股 × 均價 600');
});

test('現金只累加到當天為止的流水', () => {
  const s = sources({
    accounts: [{ id: 'a1', owner_id: KENT, currency: 'TWD', is_archived: false }],
    accountTxns: [
      { account_id: 'a1', signed_amount: 100000, transaction_date: '2026-05-01' },
      { account_id: 'a1', signed_amount: -30000, transaction_date: '2026-06-15' },
      { account_id: 'a1', signed_amount: 5000, transaction_date: '2026-08-01' },
    ],
  });

  assert.equal(computeSnapshotRows(s, '2026-05-31', noPrice, 1)[0].cash_twd, 100000);
  assert.equal(computeSnapshotRows(s, '2026-06-30', noPrice, 1)[0].cash_twd, 70000);
  assert.equal(computeSnapshotRows(s, '2026-08-31', noPrice, 1)[0].cash_twd, 75000);
});

test('已封存的帳戶不計入', () => {
  const s = sources({
    accounts: [{ id: 'a1', owner_id: KENT, currency: 'TWD', is_archived: true }],
    accountTxns: [{ account_id: 'a1', signed_amount: 100000, transaction_date: '2026-05-01' }],
  });

  assert.equal(computeSnapshotRows(s, '2026-06-01', noPrice, 1)[0].cash_twd, 0);
});

test('美元資產用當天的匯率換算', () => {
  const s = sources({
    accounts: [{ id: 'a1', owner_id: KENT, currency: 'USD', is_archived: false }],
    accountTxns: [{ account_id: 'a1', signed_amount: 1000, transaction_date: '2026-05-01' }],
  });

  assert.equal(computeSnapshotRows(s, '2026-06-01', noPrice, 31.5)[0].cash_twd, 31500);
  assert.equal(computeSnapshotRows(s, '2026-07-01', noPrice, 30)[0].cash_twd, 30000);
});

test('每位成員一列,家庭再多一列合計', () => {
  const s = sources({
    profiles: [
      { id: KENT, household_id: HOME },
      { id: WIFE, household_id: HOME },
    ],
    stockTxns: [
      stockTxn({ id: 's1', owner_id: KENT, shares: 1000 }),
      stockTxn({ id: 's2', owner_id: WIFE, shares: 500 }),
    ],
  });

  const rows = computeSnapshotRows(s, '2026-06-01', () => 700, 1);
  const total = rows.find((r) => r.owner_id === null);

  assert.equal(rows.length, 3, '兩位成員 + 一列合計');
  assert.equal(rows.find((r) => r.owner_id === KENT)?.stock_twd, 700000);
  assert.equal(rows.find((r) => r.owner_id === WIFE)?.stock_twd, 350000);
  assert.equal(total?.stock_twd, 1050000, '合計要等於成員相加');
  assert.equal(total?.household_id, HOME);
});

test('賣出之後的日子持股要跟著減少', () => {
  const s = sources({
    stockTxns: [
      stockTxn({ id: 's1', shares: 1000 }),
      stockTxn({
        id: 's2',
        type: 'sell',
        shares: 400,
        price: 700,
        transaction_date: '2026-07-10',
        created_at: '2026-07-10T00:00:00Z',
      }),
    ],
  });

  assert.equal(computeSnapshotRows(s, '2026-07-09', () => 700, 1)[0].stock_twd, 700000);
  assert.equal(computeSnapshotRows(s, '2026-07-10', () => 700, 1)[0].stock_twd, 420000);
});

test('還沒加入家庭的成員不會產生快照', () => {
  const s = sources({ profiles: [{ id: KENT, household_id: null }] });
  assert.deepEqual(computeSnapshotRows(s, '2026-06-01', noPrice, 1), []);
});

test('eachDay 含頭尾,跨月正確', () => {
  assert.deepEqual(eachDay('2026-05-30', '2026-06-02'), [
    '2026-05-30',
    '2026-05-31',
    '2026-06-01',
    '2026-06-02',
  ]);
  assert.deepEqual(eachDay('2026-05-13', '2026-05-13'), ['2026-05-13']);
});

test('carryForward 讓週末沿用最近一次收盤價', () => {
  // 5/15 週五收盤 120,週末沒有交易,5/18 週一收 125
  const closes = new Map([
    ['2026-05-15', 120],
    ['2026-05-18', 125],
  ]);
  const filled = carryForward(closes, eachDay('2026-05-15', '2026-05-18'));

  assert.equal(filled.get('2026-05-16'), 120, '週六沿用週五');
  assert.equal(filled.get('2026-05-17'), 120, '週日沿用週五');
  assert.equal(filled.get('2026-05-18'), 125);
});

test('carryForward:第一個收盤日之前不給價,不要往回猜', () => {
  const filled = carryForward(new Map([['2026-05-15', 120]]), eachDay('2026-05-13', '2026-05-15'));

  assert.equal(filled.has('2026-05-13'), false);
  assert.equal(filled.has('2026-05-14'), false);
  assert.equal(filled.get('2026-05-15'), 120);
});
