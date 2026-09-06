/**
 * 快照要用的原始資料讀取與寫回 —— 每日同步與歷史回填共用。
 *
 * 計算本身在 lib/snapshots.ts,這裡只負責跟資料庫來回。
 */

import { db, explainWriteError } from './db.ts';
import type { StockTransaction } from '../lib/holdings.ts';
import type { SnapshotRow, SnapshotSources } from '../lib/snapshots.ts';

/**
 * 一次撈齊算快照要的所有原始資料。
 *
 * 刻意不依日期過濾:回填要算好幾個月的每一天,撈一次就夠,
 * 由 computeSnapshotRows() 自己依日期取捨。
 *
 * 還沒有人加入家庭時回 null。
 */
export async function loadSnapshotSources(): Promise<SnapshotSources | null> {
  const { data: profiles, error: profileError } = await db()
    .from('profiles')
    .select('id, household_id')
    .not('household_id', 'is', null);
  if (profileError) throw new Error(`讀取成員失敗:${profileError.message}`);
  if (!profiles || profiles.length === 0) return null;

  const { data: accounts, error: acctError } = await db()
    .from('accounts')
    .select('id, owner_id, currency, is_archived');
  if (acctError) throw new Error(`讀取帳戶失敗:${acctError.message}`);

  const { data: accountTxns, error: txnError } = await db()
    .from('account_transactions')
    .select('account_id, signed_amount, transaction_date');
  if (txnError) throw new Error(`讀取帳戶收支失敗:${txnError.message}`);

  const { data: stockTxns, error: stockError } = await db()
    .from('stock_transactions')
    .select('id, owner_id, symbol, type, shares, price, fee, transaction_date, created_at');
  if (stockError) throw new Error(`讀取股票交易失敗:${stockError.message}`);

  const { data: stocks } = await db().from('stocks').select('symbol, currency');

  return {
    profiles: profiles as SnapshotSources['profiles'],
    accounts: (accounts ?? []) as SnapshotSources['accounts'],
    accountTxns: (accountTxns ?? []) as SnapshotSources['accountTxns'],
    stockTxns: (stockTxns ?? []).map((t) => ({
      ...t,
      shares: Number(t.shares),
      price: Number(t.price),
      fee: Number(t.fee),
    })) as StockTransaction[],
    currencyBySymbol: new Map((stocks ?? []).map((s) => [s.symbol, s.currency as string])),
  };
}

/**
 * 刪掉 [from, to] 區間以外的所有快照。
 *
 * 回填只會重寫它算得到的那幾天。把最早一筆交易的日期往後改(例如把期初持股的
 * 持有起始日從 1/1 改成 5/13),區間就縮短了,而舊區間前面那段快照會原封不動
 * 留著 —— 趨勢圖上會看到一段你其實還沒持有任何東西的資產。
 *
 * 用兩個單純的比較,不用 or() 組字串。
 */
export async function clearSnapshotsOutside(from: string, to: string): Promise<void> {
  const { error: beforeError } = await db()
    .from('daily_net_worth_snapshots')
    .delete()
    .lt('snapshot_date', from);
  if (beforeError) throw explainWriteError(beforeError, '清除區間之前的快照');

  const { error: afterError } = await db()
    .from('daily_net_worth_snapshots')
    .delete()
    .gt('snapshot_date', to);
  if (afterError) throw explainWriteError(afterError, '清除區間之後的快照');
}

/**
 * 先刪掉這些日期的舊快照再寫入新的 —— 同一天重跑不會產生重複。
 *
 * 刪除以日期為單位,所以回填會把該區間內既有的(可能是錯的)快照整段換掉。
 */
export async function replaceSnapshots(dates: string[], rows: SnapshotRow[]): Promise<void> {
  if (dates.length === 0) return;

  const { error: deleteError } = await db()
    .from('daily_net_worth_snapshots')
    .delete()
    .in('snapshot_date', dates);
  if (deleteError) throw explainWriteError(deleteError, '清除既有快照');

  if (rows.length === 0) return;

  // PostgREST 一次吞太大包會被擋,分批送
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db()
      .from('daily_net_worth_snapshots')
      .insert(rows.slice(i, i + CHUNK));
    if (error) throw explainWriteError(error, '寫入快照');
  }
}
