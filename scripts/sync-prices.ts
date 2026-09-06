/**
 * 每日同步:抓股價與匯率,並重算每個人與每個家庭的總資產快照。
 *
 * 由 GitHub Actions 每天排程執行,也可以本機手動跑:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run sync
 *
 * 用的是 service role 金鑰,會繞過 RLS(必須繞過,才能替所有家庭成員算快照)。
 * 這把金鑰只放在 GitHub Secrets,絕對不要進到前端。
 */

import { pathToFileURL } from 'node:url';
import { db, explainWriteError } from './db.ts';
import { computeSnapshotRows } from '../lib/snapshots.ts';
import { loadSnapshotSources, replaceSnapshots } from './snapshot-data.ts';
import {
  fetchTpexCloses,
  fetchTwSymbols,
  fetchTwseCloses,
  fetchUsClose,
  fetchUsdTwd,
  type PriceRow,
} from './providers.ts';

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

function log(msg: string) {
  console.log(msg);
}

/**
 * 開跑前先確認金鑰真的能寫入,不要等抓完一輪報價才失敗。
 * 用 ISO 4217 保留給測試用的貨幣代碼 XTS,不會撞到真實資料。
 */
async function preflight(): Promise<void> {
  const probe = {
    rate_date: '1970-01-01',
    from_currency: 'XTS',
    to_currency: 'XTS',
    rate: 1,
  };

  const { error } = await db()
    .from('fx_rates')
    .upsert(probe, { onConflict: 'rate_date,from_currency,to_currency' });

  if (error) throw explainWriteError(error, '金鑰權限檢查');

  await db().from('fx_rates').delete().eq('from_currency', 'XTS').eq('to_currency', 'XTS');
  log('金鑰權限檢查:通過(可繞過 RLS)');
}

// ---------------------------------------------------------------------------
// 1. 股價
// ---------------------------------------------------------------------------

async function syncPrices(): Promise<number> {
  const { data: stocks, error } = await db().from('stocks').select('symbol, market');
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
    const { error: upsertError } = await db()
      .from('stock_price_history')
      .upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })), {
        onConflict: 'symbol,price_date',
      });
    if (upsertError) throw explainWriteError(upsertError, '寫入股價');
  }

  log(`股價:成功寫入 ${rows.length} / ${stocks.length} 檔`);
  return rows.length;
}

// ---------------------------------------------------------------------------
// 2. 台股代號字典(新增交易時的自動完成用)
// ---------------------------------------------------------------------------

/** PostgREST 一次吞太大包會被擋,分批送 */
const SYMBOL_CHUNK = 1000;

async function syncSymbols(): Promise<number> {
  const symbols = await fetchTwSymbols();

  if (symbols.length === 0) {
    console.warn('  兩個來源都沒回資料,這次跳過(保留資料庫既有的字典)');
    return 0;
  }

  const stamp = new Date().toISOString();

  for (let i = 0; i < symbols.length; i += SYMBOL_CHUNK) {
    const chunk = symbols.slice(i, i + SYMBOL_CHUNK);
    const { error } = await db()
      .from('market_symbols')
      .upsert(
        chunk.map((s) => ({ ...s, updated_at: stamp })),
        { onConflict: 'market,symbol' }
      );
    if (error) throw explainWriteError(error, '寫入代號字典');
  }

  log(`代號字典:${symbols.length} 檔台股`);
  return symbols.length;
}

// ---------------------------------------------------------------------------
// 3. 匯率
// ---------------------------------------------------------------------------

/** 從資料庫取回最近一次抓到的匯率,當作抓取失敗時的備援 */
async function lastKnownUsdTwd(): Promise<number | null> {
  const { data } = await db()
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

  const { error } = await db()
    .from('fx_rates')
    .upsert({ ...fx, updated_at: new Date().toISOString() }, {
      onConflict: 'rate_date,from_currency,to_currency',
    });
  if (error) throw explainWriteError(error, '寫入匯率');

  log(`匯率:1 USD = ${fx.rate} TWD(${fx.rate_date})`);
  return fx.rate;
}

// ---------------------------------------------------------------------------
// 4. 重算每日總資產快照
// ---------------------------------------------------------------------------

async function rebuildSnapshots(usdToTwd: number): Promise<number> {
  const sources = await loadSnapshotSources();
  if (!sources) {
    log('快照:還沒有設定家庭的使用者,跳過');
    return 0;
  }

  const { data: latest } = await db()
    .from('latest_stock_prices')
    .select('symbol, close_price');
  const priceBySymbol = new Map((latest ?? []).map((p) => [p.symbol, Number(p.close_price)]));

  const rows = computeSnapshotRows(
    sources,
    today,
    (symbol) => priceBySymbol.get(symbol) ?? null,
    usdToTwd
  );

  await replaceSnapshots([today], rows);

  log(`快照:寫入 ${rows.length} 列(${sources.profiles.length} 位成員 + 家庭合計)`);
  return rows.length;
}

// ---------------------------------------------------------------------------

async function main() {
  log(`=== 每日同步 ${today}(台北時間)===`);

  await preflight();

  log('\n[1/4] 同步股價');
  await syncPrices();

  /*
   * 代號字典只是新增交易時的便利功能,壞掉不該讓整份同步失敗 ——
   * 價格與快照才是這支腳本真正的職責。
   */
  log('\n[2/4] 同步台股代號字典');
  try {
    await syncSymbols();
  } catch (err) {
    console.warn(`  代號字典同步失敗,不影響其他資料:${(err as Error).message}`);
  }

  log('\n[3/4] 同步匯率');
  const usdToTwd = await syncFx();

  log('\n[4/4] 重算總資產快照');
  await rebuildSnapshots(usdToTwd);

  log('\n完成');
}

// 只有直接執行這支腳本時才跑,被測試 import 時不會有副作用
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('\n同步失敗:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
