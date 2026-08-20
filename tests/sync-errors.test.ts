/**
 * 驗證同步腳本的錯誤判讀:金鑰拿錯時要給出可行動的訊息,
 * 而不是把 Postgres 那句看不懂的 RLS 錯誤原封不動丟出來。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainWriteError } from '../scripts/sync-prices.ts';

test('RLS 阻擋:依錯誤訊息判斷(Supabase 實際回傳的字串)', () => {
  const err = explainWriteError(
    { message: 'new row violates row-level security policy for table "fx_rates"' },
    '寫入匯率'
  );
  assert.match(err.message, /寫入匯率失敗/);
  assert.match(err.message, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(err.message, /sb_secret_/);
  assert.match(err.message, /不是 sb_publishable_/);
});

test('RLS 阻擋:依 Postgres 錯誤代碼 42501 判斷', () => {
  const err = explainWriteError({ message: 'permission denied', code: '42501' }, '寫入股價');
  assert.match(err.message, /Row Level Security/);
  assert.match(err.message, /Settings → API Keys/);
});

test('RLS 阻擋:大小寫不同也要抓得到', () => {
  const err = explainWriteError({ message: 'Violates Row-Level Security Policy' }, '寫入快照');
  assert.match(err.message, /金鑰/);
});

test('其他錯誤:原樣呈現,不要誤導成金鑰問題', () => {
  const err = explainWriteError(
    { message: 'duplicate key value violates unique constraint' },
    '寫入股價'
  );
  assert.equal(err.message, '寫入股價失敗:duplicate key value violates unique constraint');
  assert.doesNotMatch(err.message, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('網路類錯誤也不該被誤判為金鑰問題', () => {
  const err = explainWriteError({ message: 'fetch failed' }, '金鑰權限檢查');
  assert.equal(err.message, '金鑰權限檢查失敗:fetch failed');
});
