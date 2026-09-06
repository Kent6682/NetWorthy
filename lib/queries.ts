import { cache } from 'react';
import { createClient } from './supabase/server.ts';
import type { StockTransaction } from './holdings.ts';
import type { AccountBalance, LatestPrice, NetWorthSnapshot, Profile, Stock } from './types.ts';

export type Scope = 'me' | 'family';

export function parseScope(value: string | undefined): Scope {
  return value === 'family' ? 'family' : 'me';
}

/**
 * 目前登入者與其家庭成員。
 *
 * 用 cache() 包住:同一個請求裡 layout 與頁面都會呼叫這支,
 * 沒有這層的話 auth.getUser() 與成員查詢會整組跑兩次。
 * cache() 的作用範圍是單一請求,不會跨請求或跨使用者共用。
 */
export const getSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  /*
   * 只查一次。profiles 的 RLS 是「自己 or 同家庭」,所以這一次就同時拿到
   * 自己的 profile 與成員清單 —— 不需要再單獨查一次自己那列。
   * 還沒加入家庭的人,這裡就只會回自己一列。
   */
  const { data } = await supabase
    .from('profiles')
    .select('id, household_id, display_name')
    .order('created_at');

  const members = (data ?? []) as Profile[];
  const profile = members.find((m) => m.id === user.id);

  // 註冊後 profile 的觸發器還沒跑完時會是這種情形
  if (!profile) return null;

  return {
    userId: user.id,
    email: user.email ?? '',
    profile,
    members,
  };
});

/** 依視角決定要納入哪些人的資料 */
export function ownerIdsForScope(
  scope: Scope,
  userId: string,
  members: Profile[]
): string[] {
  return scope === 'family' && members.length > 0 ? members.map((m) => m.id) : [userId];
}

/** 最新美元兌台幣匯率;抓不到就退回 1(等於不換算,並在畫面上提示) */
export async function getUsdToTwd(): Promise<{ rate: number; date: string | null }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('latest_fx_rates')
    .select('rate, rate_date')
    .eq('from_currency', 'USD')
    .eq('to_currency', 'TWD')
    .maybeSingle();

  return { rate: data ? Number(data.rate) : 1, date: data?.rate_date ?? null };
}

/** 帳戶餘額(已由資料庫 view 累加流水帳算出) */
export async function getAccountBalances(ownerIds: string[]): Promise<AccountBalance[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('account_balances')
    .select('*')
    .in('owner_id', ownerIds)
    .order('type')
    .order('institution');
  return (data ?? []) as AccountBalance[];
}

export async function getStockTransactions(ownerIds: string[]): Promise<StockTransaction[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('stock_transactions')
    .select('id, owner_id, account_id, symbol, type, shares, price, fee, transaction_date, created_at')
    .in('owner_id', ownerIds)
    .order('transaction_date', { ascending: false });

  return (data ?? []).map((t) => ({
    ...t,
    shares: Number(t.shares),
    price: Number(t.price),
    fee: Number(t.fee),
  })) as StockTransaction[];
}

export async function getStocks(): Promise<Stock[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('stocks').select('symbol, market, name, currency');
  return (data ?? []) as Stock[];
}

export async function getLatestPrices(): Promise<LatestPrice[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('latest_stock_prices').select('symbol, price_date, close_price');
  return (data ?? []).map((p) => ({ ...p, close_price: Number(p.close_price) })) as LatestPrice[];
}

/** 日曆用:指定區間的每日快照(要含起始日的前一天,才算得出第一天的盈虧) */
export async function getSnapshotRange(
  scope: Scope,
  userId: string,
  from: string,
  to: string
): Promise<NetWorthSnapshot[]> {
  const supabase = await createClient();

  let query = supabase
    .from('daily_net_worth_snapshots')
    .select('snapshot_date, cash_twd, stock_twd, total_twd, owner_id')
    .gte('snapshot_date', from)
    .lte('snapshot_date', to)
    .order('snapshot_date');

  query = scope === 'family' ? query.is('owner_id', null) : query.eq('owner_id', userId);

  const { data } = await query;
  return (data ?? []) as NetWorthSnapshot[];
}

/**
 * 日曆用:每天的淨外部資金流入,用來從盈虧裡扣掉。
 *
 * 只算 deposit 與 withdraw,而且只算不是股票交易連動產生的那些:
 *   - 轉出 / 轉入  帳戶間搬錢,成對記錄本來就互相抵銷
 *   - 股票交割    現金變股票,總資產不變(這些列的 stock_transaction_id 不是 null)
 *   - 對帳調整    帳務更正,錢一直都在只是漏記。算成盈虧會產生假的尖峰
 */
export async function getExternalFlows(
  ownerIds: string[],
  from: string,
  to: string
): Promise<Map<string, number>> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('account_transactions')
    .select('transaction_date, signed_amount, accounts!inner(owner_id)')
    .in('accounts.owner_id', ownerIds)
    .in('type', ['deposit', 'withdraw'])
    .is('stock_transaction_id', null)
    .gte('transaction_date', from)
    .lte('transaction_date', to);

  const flows = new Map<string, number>();
  for (const row of data ?? []) {
    const date = row.transaction_date as string;
    flows.set(date, (flows.get(date) ?? 0) + Number(row.signed_amount));
  }
  return flows;
}

/** 首頁趨勢線資料:個人視角取自己那列,全家視角取 owner_id 為 null 的合計列 */
export async function getSnapshots(
  scope: Scope,
  userId: string,
  months: number
): Promise<NetWorthSnapshot[]> {
  const supabase = await createClient();

  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const sinceStr = since.toISOString().slice(0, 10);

  let query = supabase
    .from('daily_net_worth_snapshots')
    .select('snapshot_date, cash_twd, stock_twd, total_twd, owner_id')
    .gte('snapshot_date', sinceStr)
    .order('snapshot_date');

  query = scope === 'family' ? query.is('owner_id', null) : query.eq('owner_id', userId);

  const { data } = await query;
  return (data ?? []) as NetWorthSnapshot[];
}
