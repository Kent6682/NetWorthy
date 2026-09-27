/**
 * 快照要用的原始資料讀取與寫回 —— 每日同步與歷史回填共用。
 *
 * 計算本身在 lib/snapshots.ts,這裡只負責跟資料庫來回。
 */

import { db, explainWriteError, selectAll } from './db.ts';
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
  /*
   * 每張表都分頁撈完 —— 帳戶流水與股票交易會一直長,超過 1,000 列時
   * 少讀的那一截會讓快照的餘額與持股默默算錯。排序都補到主鍵,分頁才穩定。
   */
  const read = async <T>(label: string, run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) => {
    try {
      return await selectAll<T>(run);
    } catch (err) {
      throw new Error(`讀取${label}失敗:${(err as Error).message}`);
    }
  };

  const profiles = await read<{ id: string; household_id: string }>('成員', (a, b) =>
    db().from('profiles').select('id, household_id').not('household_id', 'is', null).order('id').range(a, b)
  );
  if (profiles.length === 0) return null;

  const [accounts, accountTxns, stockTxns, stocks] = await Promise.all([
    read<SnapshotSources['accounts'][number]>('帳戶', (a, b) =>
      db().from('accounts').select('id, owner_id, currency, is_archived').order('id').range(a, b)
    ),
    read<SnapshotSources['accountTxns'][number]>('帳戶收支', (a, b) =>
      db()
        .from('account_transactions')
        .select('account_id, signed_amount, transaction_date')
        .order('id')
        .range(a, b)
    ),
    read<StockTransaction>('股票交易', (a, b) =>
      db()
        .from('stock_transactions')
        .select('id, owner_id, symbol, type, shares, price, fee, transaction_date, created_at')
        .order('id')
        .range(a, b)
    ),
    read<{ symbol: string; currency: string }>('股票清單', (a, b) =>
      db().from('stocks').select('symbol, currency').order('symbol').range(a, b)
    ),
  ]);

  return {
    profiles: profiles as SnapshotSources['profiles'],
    accounts,
    accountTxns,
    stockTxns: stockTxns.map((t) => ({
      ...t,
      shares: Number(t.shares),
      price: Number(t.price),
      fee: Number(t.fee),
    })),
    currencyBySymbol: new Map(stocks.map((st) => [st.symbol, st.currency])),
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

  // 日期放在網址參數裡,幾百天一次送會太長;每批 100 天
  const DATE_CHUNK = 100;
  for (let i = 0; i < dates.length; i += DATE_CHUNK) {
    const { error: deleteError } = await db()
      .from('daily_net_worth_snapshots')
      .delete()
      .in('snapshot_date', dates.slice(i, i + DATE_CHUNK));
    if (deleteError) throw explainWriteError(deleteError, '清除既有快照');
  }

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

/**
 * 算完之後清掉待重算清單。只清「開跑之前」提出的 ——
 * 同步跑到一半時又有人改了交易,那一筆要留給下一次。
 */
export async function clearRebuildRequests(startedAt: string): Promise<void> {
  const { error } = await db()
    .from('snapshot_rebuild_requests')
    .delete()
    .lte('requested_at', startedAt);
  if (error) throw explainWriteError(error, '清除待重算清單');
}
