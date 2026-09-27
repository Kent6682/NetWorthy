import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectAll } from '../scripts/db.ts';

test('分頁撈完:超過一頁的資料不能被截掉', async () => {
  const rows = Array.from({ length: 2345 }, (_, i) => i);
  const calls: [number, number][] = [];

  const all = await selectAll<number>(async (from, to) => {
    calls.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  });

  assert.equal(all.length, 2345);
  assert.deepEqual(calls, [
    [0, 999],
    [1000, 1999],
    [2000, 2999],
  ]);
});

test('剛好整頁時要再問一次才知道結束', async () => {
  let n = 0;
  const all = await selectAll<number>(async (from, to) => {
    n += 1;
    return { data: Array.from({ length: 1000 }).map((_, i) => from + i).filter((v) => v < 1000 && v <= to), error: null };
  });
  assert.equal(all.length, 1000);
  assert.equal(n, 2);
});

test('查詢出錯要丟出來,不能當成沒有資料', async () => {
  await assert.rejects(
    selectAll(async () => ({ data: null, error: { message: 'boom' } })),
    /boom/
  );
});
