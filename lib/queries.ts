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
