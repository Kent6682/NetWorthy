/**
 * 每日同步:抓股價與匯率,並重算每個人與每個家庭的總資產快照。
 *
 * 由 GitHub Actions 每天排程執行,也可以本機手動跑:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run sync
 *
 * 用的是 service role 金鑰,會繞過 RLS(必須繞過,才能替所有家庭成員算快照)。
 * 這把金鑰只放在 GitHub Secrets,絕對不要進到前端。
 */

import { createClient } from '@supabase/supabase-js';
import { calculateHoldings, type StockTransaction } from '../lib/holdings.ts';
import {
  fetchTpexCloses,
  fetchTwseCloses,
  fetchUsClose,
  fetchUsdTwd,
  type PriceRow,
} from './providers.ts';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('缺少環境變數 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

function log(msg: string) {
  console.log(msg);
}

// ---------------------------------------------------------------------------
// 1. 股價
// ---------------------------------------------------------------------------

async function syncPrices(): Promise<number> {
  const { data: stocks, error } = await supabase.from('stocks').select('symbol, market');
  if (error) throw new Error(`讀取股票清單失敗:${error.message}`);
  if (!stocks || stocks.length === 0) {
    log('沒有任何股票需要同步');
    return 0;
  }

  const twSymbols = stocks.filter((s) => s.market === 'TW').map((s) => s.symbol);
  const usSymbols = stocks.filter((s) => s.market === 'US').map((s) => s.symbol);
  const rows: PriceRow[] = [];

  // 台股:證交所 + 櫃買中心各一次呼叫,涵蓋所有上市櫃股票
  if (twSymbols.length > 0) {
    const lookup = new Map<string, PriceRow>();

    for (const [name, fetcher] of [
      ['證交所', fetchTwseCloses],
      ['櫃買中心', fetchTpexCloses],
    ] as const) {
      try {
        const map = await fetcher();
        for (const [code, row] of map) if (!lookup.has(code)) lookup.set(code, row);
        log(`  ${name}:取得 ${map.size} 檔報價`);
      } catch (err) {
        console.warn(`  ${name} 抓取失敗:${(err as Error).message}`);
      }
    }

    for (const symbol of twSymbols) {
      const row = lookup.get(symbol);
      if (row) rows.push(row);
      else console.warn(`  找不到台股 ${symbol} 的報價(可能是新股、已下市,或代號填錯)`);
    }
  }

  // 美股:逐檔抓,彼此不互相影響
  for (const symbol of usSymbols) {
    const row = await fetchUsClose(symbol);
    if (row) rows.push(row);
    else console.warn(`  找不到美股 ${symbol} 的報價`);
    await new Promise((r) => setTimeout(r, 250)); // 別打太快
  }

  if (rows.length > 0) {
    const { error: upsertError } = await supabase
      .from('stock_price_history')
      .upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })), {
        onConflict: 'symbol,price_date',
      });
    if (upsertError) throw new Error(`寫入股價失敗:${upsertError.message}`);
  }

  log(`股價:成功寫入 ${rows.length} / ${stocks.length} 檔`);
  return rows.length;
}

// ---------------------------------------------------------------------------
// 2. 匯率
// ---------------------------------------------------------------------------

/** 從資料庫取回最近一次抓到的匯率,當作抓取失敗時的備援 */
async function lastKnownUsdTwd(): Promise<number | null> {
  const { data } = await supabase
    .from('latest_fx_rates')
    .select('rate, rate_date')
    .eq('from_currency', 'USD')
    .eq('to_currency', 'TWD')
    .maybeSingle();

  if (!data) return null;
  log(`  改用資料庫裡最近一次的匯率:1 USD = ${data.rate} TWD(${data.rate_date})`);
  return Number(data.rate);
}

async function syncFx(): Promise<number> {
  const fx = await fetchUsdTwd();

  if (!fx) {
    console.warn('匯率:所有來源都抓不到');
    const fallback = await lastKnownUsdTwd();
    if (fallback !== null) return fallback;
    // 沒有任何歷史匯率可用。用 1 換算會讓美元資產嚴重失真,
    // 所以直接讓這次同步失敗,而不是寫入一份錯的快照。
    throw new Error('抓不到匯率,資料庫裡也沒有歷史匯率可用 — 中止,避免寫入失真的資產快照');
  }

  const { error } = await supabase
    .from('fx_rates')
    .upsert({ ...fx, updated_at: new Date().toISOString() }, {
      onConflict: 'rate_date,from_currency,to_currency',
    });
  if (error) throw new Error(`寫入匯率失敗:${error.message}`);

  log(`匯率:1 USD = ${fx.rate} TWD(${fx.rate_date})`);
  return fx.rate;
}

// ---------------------------------------------------------------------------
// 3. 重算每日總資產快照
// ---------------------------------------------------------------------------

interface SnapshotRow {
  household_id: string;
  owner_id: string | null;
  snapshot_date: string;
  cash_twd: number;
  stock_twd: number;
  total_twd: number;
}

async function rebuildSnapshots(usdToTwd: number): Promise<number> {
  // 成員 → 家庭
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, household_id')
    .not('household_id', 'is', null);
  if (profileError) throw new Error(`讀取成員失敗:${profileError.message}`);
  if (!profiles || profiles.length === 0) {
    log('快照:還沒有設定家庭的使用者,跳過');
    return 0;
  }

  // 帳戶餘額(由流水帳累加)
  const { data: accounts, error: acctError } = await supabase
    .from('accounts')
    .select('id, owner_id, currency, is_archived');
  if (acctError) throw new Error(`讀取帳戶失敗:${acctError.message}`);

  const { data: acctTxns, error: txnError } = await supabase
    .from('account_transactions')
    .select('account_id, signed_amount')
    .lte('transaction_date', today);
  if (txnError) throw new Error(`讀取帳戶收支失敗:${txnError.message}`);

  const balanceByAccount = new Map<string, number>();
  for (const t of acctTxns ?? []) {
    balanceByAccount.set(
      t.account_id,
      (balanceByAccount.get(t.account_id) ?? 0) + Number(t.signed_amount)
    );
  }

  const cashByOwner = new Map<string, number>();
  for (const a of accounts ?? []) {
    if (a.is_archived) continue;
    const raw = balanceByAccount.get(a.id) ?? 0;
    const twd = a.currency === 'USD' ? raw * usdToTwd : raw;
    cashByOwner.set(a.owner_id, (cashByOwner.get(a.owner_id) ?? 0) + twd);
  }

  // 股票市值
  const { data: stockTxns, error: stockError } = await supabase
    .from('stock_transactions')
    .select('id, owner_id, symbol, type, shares, price, fee, transaction_date, created_at')
    .lte('transaction_date', today);
  if (stockError) throw new Error(`讀取股票交易失敗:${stockError.message}`);

  const { data: stocks } = await supabase.from('stocks').select('symbol, currency');
  const { data: latest } = await supabase
    .from('latest_stock_prices')
    .select('symbol, close_price');

  const currencyBySymbol = new Map((stocks ?? []).map((s) => [s.symbol, s.currency]));
  const priceBySymbol = new Map((latest ?? []).map((p) => [p.symbol, Number(p.close_price)]));

  const normalized: StockTransaction[] = (stockTxns ?? []).map((t) => ({
    ...t,
    shares: Number(t.shares),
    price: Number(t.price),
    fee: Number(t.fee),
  })) as StockTransaction[];

  const stockByOwner = new Map<string, number>();
  for (const h of calculateHoldings(normalized)) {
    if (h.shares <= 0) continue;
    // 沒有報價時退回成本價,總資產不會因為缺一天報價就憑空少一塊
    const price = priceBySymbol.get(h.symbol) ?? h.avgCost;
    const value = h.shares * price;
    const twd = currencyBySymbol.get(h.symbol) === 'USD' ? value * usdToTwd : value;
    stockByOwner.set(h.ownerId, (stockByOwner.get(h.ownerId) ?? 0) + twd);
  }

  // 組出每人一列 + 每個家庭一列合計
  const rows: SnapshotRow[] = [];
  const householdTotals = new Map<string, { cash: number; stock: number }>();

  for (const p of profiles) {
    const cash = cashByOwner.get(p.id) ?? 0;
    const stock = stockByOwner.get(p.id) ?? 0;

    rows.push({
      household_id: p.household_id!,
      owner_id: p.id,
      snapshot_date: today,
      cash_twd: round2(cash),
      stock_twd: round2(stock),
      total_twd: round2(cash + stock),
    });

    const agg = householdTotals.get(p.household_id!) ?? { cash: 0, stock: 0 };
    agg.cash += cash;
    agg.stock += stock;
    householdTotals.set(p.household_id!, agg);
  }

  for (const [householdId, agg] of householdTotals) {
    rows.push({
      household_id: householdId,
      owner_id: null, // null = 全家合計
      snapshot_date: today,
      cash_twd: round2(agg.cash),
      stock_twd: round2(agg.stock),
      total_twd: round2(agg.cash + agg.stock),
    });
  }

  // 先刪掉今天的舊資料再寫入,重跑同一天不會產生重複
  const { error: deleteError } = await supabase
    .from('daily_net_worth_snapshots')
    .delete()
    .eq('snapshot_date', today);
  if (deleteError) throw new Error(`清除今日快照失敗:${deleteError.message}`);

  const { error: insertError } = await supabase.from('daily_net_worth_snapshots').insert(rows);
  if (insertError) throw new Error(`寫入快照失敗:${insertError.message}`);

  log(`快照:寫入 ${rows.length} 列(${profiles.length} 位成員 + ${householdTotals.size} 個家庭合計)`);
  return rows.length;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ---------------------------------------------------------------------------

async function main() {
  log(`=== 每日同步 ${today}(台北時間)===`);

  log('\n[1/3] 同步股價');
  await syncPrices();

  log('\n[2/3] 同步匯率');
  const usdToTwd = await syncFx();

  log('\n[3/3] 重算總資產快照');
  await rebuildSnapshots(usdToTwd);

  log('\n完成');
}

main().catch((err) => {
  console.error('\n同步失敗:', err instanceof Error ? err.message : err);
  process.exit(1);
});
