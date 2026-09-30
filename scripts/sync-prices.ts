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
import { db, explainWriteError, selectAll } from './db.ts';
import { computeSnapshotRows, eachDay } from '../lib/snapshots.ts';
import { buildPriceLookup, previousDay } from '../lib/pnl.ts';
import { clearRebuildRequests, loadSnapshotSources, replaceSnapshots } from './snapshot-data.ts';
import {
  fetchTpexCloses,
  fetchTpexCorporateActions,
  fetchTpexDaily,
  fetchTwseDaily,
  fetchTwQuote,
  fetchTwHolidays,
  fetchTwSymbols,
  fetchTwseCloses,
  fetchTwseCorporateActions,
  fetchUsClose,
  fetchUsdTwd,
  isCloseSettled,
  type CorporateActionRow,
  type PriceRow,
  type TwBoard,
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

/** 往回找正式收盤價要涵蓋幾個日曆天 —— 排程被 GitHub 跳過一兩班也補得回來 */
const OFFICIAL_LOOKBACK_DAYS = 6;

/**
 * 要向交易所要正式收盤價的日子:今天往回幾天,略過週末,新的在前。
 * 國定假日照樣問 —— 交易所會回空的,多一次請求而已,不必另外查假日表。
 */
export function officialPriceDates(today: string, lookback = OFFICIAL_LOOKBACK_DAYS): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${today}T00:00:00Z`);
  for (let i = 0; i <= lookback; i += 1) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates;
}

/**
 * 台股收盤價,依可信度由高到低:
 *
 *   1. 交易所「指定日期」的正式行情(證交所 MI_INDEX、櫃買 dailyQuotes)
 *      —— 當天收盤後就有。近幾個交易日**每次都重抓**,之前用後備來源先補上的
 *         價格會被正式價格蓋掉,當日與前日的收盤價因此一定是正式的。
 *   2. openapi 的全市場檔案 —— 正式價格,但證交所那份要到隔天早上才更新。
 *   3. Yahoo 逐檔 —— 以上都還沒有今天時才問,而且會略過還在交易中的那一根。
 *
 * 同一個「代號 + 日期」只留可信度最高的那一筆。
 */
export async function syncTwPrices(
  twSymbols: string[],
  put: (r: PriceRow) => void,
  has: (symbol: string, date: string) => boolean
): Promise<void> {
  const board = new Map<string, TwBoard>();
  const latest = new Map<string, string>();
  const note = (r: PriceRow, code: TwBoard) => {
    put(r);
    board.set(r.symbol, code);
    if (r.price_date > (latest.get(r.symbol) ?? '')) latest.set(r.symbol, r.price_date);
  };

  // --- 1. 正式行情,逐日 ---------------------------------------------------
  const found: string[] = [];
  for (const date of officialPriceDates(today)) {
    let count = 0;
    for (const [name, fetcher, code] of [
      ['證交所', fetchTwseDaily, 'TW'],
      ['櫃買中心', fetchTpexDaily, 'TWO'],
    ] as const) {
      try {
        const map = await fetcher(date);
        for (const symbol of twSymbols) {
          const row = map.get(symbol);
          if (row && !has(symbol, date)) {
            note(row, code);
            count += 1;
          }
        }
      } catch (err) {
        console.warn(`  ${name} ${date} 行情抓取失敗:${(err as Error).message}`);
      }
      // 證交所大約每 5 秒只接受 3 次請求
      await sleep(TWSE_GAP_MS);
    }
    if (count > 0) found.push(`${date.slice(5)} ${count} 檔`);
  }
  log(`  正式收盤價:${found.length > 0 ? found.join('、') : '近幾天都沒有(可能連假)'}`);

  // --- 2. openapi 全市場檔案 ---------------------------------------------
  for (const [name, fetcher, code] of [
    ['證交所 openapi', fetchTwseCloses, 'TW'],
    ['櫃買中心 openapi', fetchTpexCloses, 'TWO'],
  ] as const) {
    try {
      const map = await fetcher();
      for (const symbol of twSymbols) {
        const row = map.get(symbol);
        if (row && !has(symbol, row.price_date)) note(row, code);
        // 正式行情裡找不到、這裡才找到的,也要記下它是上市還是上櫃
        if (row && !board.has(symbol)) board.set(symbol, code);
      }
    } catch (err) {
      console.warn(`  ${name} 抓取失敗:${(err as Error).message}`);
    }
  }

  // --- 3. Yahoo 逐檔補今天 -------------------------------------------------
  let patched = 0;
  for (const symbol of twSymbols) {
    if ((latest.get(symbol) ?? '') >= today) continue;

    const fresh = await fetchTwQuote(symbol, board.get(symbol));
    if (fresh && !has(symbol, fresh.price_date)) {
      put(fresh);
      if (fresh.price_date > (latest.get(symbol) ?? '')) {
        latest.set(symbol, fresh.price_date);
        patched += 1;
      }
    } else if (!fresh && !latest.has(symbol)) {
      console.warn(`  找不到台股 ${symbol} 的報價(可能是新股、已下市,或代號填錯)`);
    }
    await sleep(250); // 別打太快
  }
  if (patched > 0) log(`  交易所還沒有較新的收盤價,用 Yahoo 暫時補上 ${patched} 檔(下一班會換成正式價格)`);
}

const TWSE_GAP_MS = 2000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 寫入的價格裡最早的日期 —— 那天以後的快照要重算;沒寫入任何價格時是 null */
async function syncPrices(): Promise<string | null> {
  let stocks: { symbol: string; market: string }[];
  try {
    stocks = await selectAll((a, b) =>
      db().from('stocks').select('symbol, market').order('symbol').range(a, b)
    );
  } catch (err) {
    throw new Error(`讀取股票清單失敗:${(err as Error).message}`);
  }
  if (stocks.length === 0) {
    log('沒有任何股票需要同步');
    return null;
  }

  const twSymbols = stocks.filter((s) => s.market === 'TW').map((s) => s.symbol);
  const usSymbols = stocks.filter((s) => s.market === 'US').map((s) => s.symbol);

  /*
   * 以「代號 + 日期」為鍵去重。
   *
   * 台股可能同一檔拿到兩筆:大盤檔案給的(可能是舊日期)與 Yahoo 補的。
   * 日期不同時兩筆都要寫;日期相同時只能留一筆 —— 同一批 upsert 裡出現重複的
   * 主鍵,Postgres 會直接拒絕整批(ON CONFLICT DO UPDATE 不能重複影響同一列)。
   */
  const rows = new Map<string, PriceRow>();
  const key = (symbol: string, date: string) => `${symbol}|${date}`;
  const put = (r: PriceRow) => rows.set(key(r.symbol, r.price_date), r);
  const has = (symbol: string, date: string) => rows.has(key(symbol, date));

  if (twSymbols.length > 0) {
    await syncTwPrices(twSymbols, put, has);
  }

  // 美股:逐檔抓,彼此不互相影響
  for (const symbol of usSymbols) {
    const row = await fetchUsClose(symbol);
    if (row) put(row);
    else console.warn(`  找不到美股 ${symbol} 的報價`);
    await new Promise((r) => setTimeout(r, 250)); // 別打太快
  }

  /*
   * 最後一道關卡:盤中(或剛收盤、收盤價還沒定案)不寫入「今天」的價格。
   *
   * 早上那班排程常延到 9 點開盤後才跑,那時候拿到的「今天收盤價」其實是盤中即時價。
   * 這裡只看時鐘,不管價格來自哪個來源 —— 昨天以前的正式收盤價、美股、匯率照常更新,
   * 擋掉的只有台股當天 14:00 前、美股當天紐約 16:15 前的價格,下一班會補上。
   */
  const now = Date.now();
  const marketOf = new Map(stocks.map((s) => [s.symbol, s.market === 'US' ? 'US' : 'TW'] as const));
  const priceRows: PriceRow[] = [];
  const unsettled: PriceRow[] = [];
  for (const r of rows.values()) {
    (isCloseSettled(marketOf.get(r.symbol) ?? 'TW', r.price_date, now) ? priceRows : unsettled).push(r);
  }
  if (unsettled.length > 0) {
    log(
      `  盤中或收盤價還沒定案,先不寫入:` +
        unsettled.map((r) => `${r.symbol} ${r.price_date.slice(5)}`).join('、')
    );
  }

  if (priceRows.length > 0) {
    const { error: upsertError } = await db()
      .from('stock_price_history')
      .upsert(priceRows.map((r) => ({ ...r, updated_at: new Date().toISOString() })), {
        onConflict: 'symbol,price_date',
      });
    if (upsertError) throw explainWriteError(upsertError, '寫入股價');
  }

  const covered = new Set(priceRows.map((r) => r.symbol)).size;
  log(`股價:${covered} / ${stocks.length} 檔有報價,共寫入 ${priceRows.length} 列`);
  return priceRows.reduce<string | null>(
    (min, r) => (min === null || r.price_date < min ? r.price_date : min),
    null
  );
}

// ---------------------------------------------------------------------------
// 2. 台股代號字典(新增交易時的自動完成用)與休市日
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

/**
 * 證交所當年度的休市日。只新增或更新,不刪除 —— 來源某天少回幾筆,
 * 不該把日曆上已經標好的假日弄掉。跨年後舊年度的資料照樣留著。
 */
async function syncHolidays(): Promise<number> {
  const holidays = await fetchTwHolidays();
  if (holidays.length === 0) {
    console.warn('  證交所行事曆沒有回資料,這次跳過');
    return 0;
  }

  const stamp = new Date().toISOString();
  const { error } = await db()
    .from('market_holidays')
    .upsert(
      holidays.map((h) => ({ ...h, updated_at: stamp })),
      { onConflict: 'market,holiday_date' }
    );
  if (error) throw explainWriteError(error, '寫入休市日');

  log(`休市日:${holidays.length} 天`);
  return holidays.length;
}

/**
 * 證交所與櫃買的除權除息預告表 → corporate_actions(「待確認配息」的資料來源)。
 *
 * 預告表只涵蓋前後一個多月,這張表靠每天寫入累積成歷史,只新增或更新、不刪除。
 * 金額還沒公布(null)的那幾筆只在第一次出現時寫入 —— 不能拿 null 去蓋掉
 * 之前已經公布的金額(來源偶爾會把已公布的欄位又顯示成空白或「尚未公告」)。
 */
async function syncCorporateActions(): Promise<number> {
  const rows: CorporateActionRow[] = [];
  for (const [name, fetcher] of [
    ['證交所', fetchTwseCorporateActions],
    ['櫃買中心', fetchTpexCorporateActions],
  ] as const) {
    try {
      rows.push(...(await fetcher()));
    } catch (err) {
      console.warn(`  ${name}除權息預告抓取失敗:${(err as Error).message}`);
    }
  }
  if (rows.length === 0) return 0;

  // 同一檔同一天兩邊都有時(理論上不會)只留一筆,避免同一批 upsert 撞主鍵
  const unique = new Map(rows.map((r) => [`${r.market}|${r.symbol}|${r.ex_date}`, r]));
  const stamp = new Date().toISOString();
  const known = [...unique.values()].filter((r) => r.cash_dividend !== null || r.stock_ratio !== null);
  const pending = [...unique.values()].filter((r) => r.cash_dividend === null && r.stock_ratio === null);

  if (known.length > 0) {
    const { error } = await db()
      .from('corporate_actions')
      .upsert(known.map((r) => ({ ...r, updated_at: stamp })), { onConflict: 'market,symbol,ex_date' });
    if (error) throw explainWriteError(error, '寫入除權息預告');
  }
  if (pending.length > 0) {
    const { error } = await db()
      .from('corporate_actions')
      .upsert(pending.map((r) => ({ ...r, updated_at: stamp })), {
        onConflict: 'market,symbol,ex_date',
        ignoreDuplicates: true,
      });
    if (error) throw explainWriteError(error, '寫入除權息預告');
  }

  log(`除權息預告:${known.length} 筆有金額、${pending.length} 筆金額還沒公布`);
  return unique.size;
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

/** 往前多抓一段報價才找得到前一個交易日 —— 農曆年可能連休九天 */
const PRICE_LOOKBACK_DAYS = 30;

function shiftDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * 重算今天,順便重算昨天。
 *
 * 為什麼要多算昨天:證交所常常在 14:30 這班排程跑完之後才公布當天收盤價。
 * 那種時候今天的快照會用前一個交易日的價格算出來,而隔天早上那班的 today
 * 已經變成新的一天,不會回頭修正 —— 那一天的快照就永久停在錯的價格上,
 * 除非手動跑回填。多算一天成本幾乎是零,卻能自動補上這種延遲。
 *
 * 也因為要重算過去的日子,這裡不能用 latest_stock_prices(每檔只有最新一天),
 * 必須依日期查價。
 */
/**
 * 交易有變動時,觸發器會在 snapshot_rebuild_requests 記下最早受影響的日期
 * (見 schema.sql)。回傳所有家庭裡最早的那一天,沒有就是 null。
 */
async function pendingRebuildFrom(): Promise<string | null> {
  const { data, error } = await db()
    .from('snapshot_rebuild_requests')
    .select('from_date')
    .order('from_date')
    .limit(1);
  if (error) throw new Error(`讀取待重算清單失敗:${error.message}`);
  return (data?.[0]?.from_date as string | undefined) ?? null;
}

async function rebuildSnapshots(
  usdToTwd: number,
  /** 這次同步寫入的最早價格日期 —— 價格可能被正式收盤價更正過,那天起的快照要跟著重算 */
  pricesFrom: string | null
): Promise<number> {
  const startedAt = new Date().toISOString();

  const sources = await loadSnapshotSources();
  if (!sources) {
    log('快照:還沒有設定家庭的使用者,跳過');
    return 0;
  }

  /*
   * 起點取三者中最早的:
   *   - 昨天:昨天那班可能是在正式收盤價公布前跑的
   *   - 待重算清單:有人補登、編輯或刪除了更早的交易
   *   - 這次寫入的最早價格日期:每次都重抓近幾個交易日的正式收盤價,其中可能有
   *     更正了之前暫用價格的(例如排程被 GitHub 跳過一兩班),那天起的快照要跟著變
   */
  const yesterday = previousDay(today);
  const requested = await pendingRebuildFrom();
  const from = [yesterday, requested, pricesFrom]
    .filter((d): d is string => d !== null)
    .reduce((a, b) => (b < a ? b : a));
  const days = eachDay(from, today);
  const since = shiftDays(from, -PRICE_LOOKBACK_DAYS);

  if (from < yesterday) {
    log(
      `快照:從 ${from} 開始重算` +
        (requested && requested === from ? '(有交易變動)' : '(近幾天的收盤價以正式價格重新寫入)')
    );
  }

  // 重算的區間可能長達好幾個月,價格要分頁撈完
  const priceRows = await selectAll<{ symbol: string; price_date: string; close_price: number }>(
    (a, b) =>
      db()
        .from('stock_price_history')
        .select('symbol, price_date, close_price')
        .gte('price_date', since)
        .lte('price_date', today)
        .order('price_date')
        .order('symbol')
        .range(a, b)
  );

  const priceAt = buildPriceLookup(
    priceRows.map((p) => ({
      symbol: p.symbol as string,
      price_date: p.price_date as string,
      close_price: Number(p.close_price),
    }))
  );

  /*
   * 匯率也要依日期查 —— 昨天該用昨天的匯率。
   * buildPriceLookup 就是「取某個序列在某天(含)以前的最後一個值」,
   * 把幣別當成 symbol 就能直接沿用,不必再寫一份同樣的邏輯。
   */
  // 重算區間長的時候匯率也可能超過一頁;每天一列,依日期排序就是唯一的
  const fxRows = await selectAll<{ rate_date: string; rate: number }>((a, b) =>
    db()
      .from('fx_rates')
      .select('rate_date, rate')
      .eq('from_currency', 'USD')
      .eq('to_currency', 'TWD')
      .gte('rate_date', since)
      .lte('rate_date', today)
      .order('rate_date')
      .range(a, b)
  );

  const fxAt = buildPriceLookup(
    fxRows.map((r) => ({
      symbol: 'USD',
      price_date: r.rate_date as string,
      close_price: Number(r.rate),
    }))
  );

  const rows = days.flatMap((day) =>
    computeSnapshotRows(
      sources,
      day,
      (symbol) => priceAt(symbol, day),
      fxAt('USD', day) ?? usdToTwd
    )
  );

  await replaceSnapshots(days, rows);
  await clearRebuildRequests(startedAt);

  log(
    `快照:重算 ${days[0]} 到 ${days[days.length - 1]}(${days.length} 天),寫入 ${rows.length} 列` +
      `(${sources.profiles.length} 位成員 + 家庭合計)`
  );
  return rows.length;
}

// ---------------------------------------------------------------------------

async function main() {
  log(`=== 每日同步 ${today}(台北時間)===`);

  await preflight();

  log('\n[1/4] 同步股價');
  const pricesFrom = await syncPrices();

  /*
   * 代號字典只是新增交易時的便利功能,壞掉不該讓整份同步失敗 ——
   * 價格與快照才是這支腳本真正的職責。
   */
  log('\n[2/4] 同步台股代號字典、休市日與除權息預告');
  try {
    await syncSymbols();
  } catch (err) {
    console.warn(`  代號字典同步失敗,不影響其他資料:${(err as Error).message}`);
  }
  // 休市日一樣只是日曆的標示,抓不到不影響價格與快照
  try {
    await syncHolidays();
  } catch (err) {
    console.warn(`  休市日同步失敗,不影響其他資料:${(err as Error).message}`);
  }
  // 除權息預告只用來提示「待確認配息」,抓不到不影響價格與快照
  try {
    await syncCorporateActions();
  } catch (err) {
    console.warn(`  除權息預告同步失敗,不影響其他資料:${(err as Error).message}`);
  }

  log('\n[3/4] 同步匯率');
  const usdToTwd = await syncFx();

  log('\n[4/4] 重算總資產快照');
  await rebuildSnapshots(usdToTwd, pricesFrom);

  log('\n完成');
}

// 只有直接執行這支腳本時才跑,被測試 import 時不會有副作用
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('\n同步失敗:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
