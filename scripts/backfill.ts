/**
 * 歷史回填:把每日總資產快照從第一筆交易那天重算到今天。
 *
 * 為什麼需要這支 ——
 * 每日同步只寫「今天」那一列,永遠不會回頭修正過去的日期。所以只要你補登
 * 一筆日期在過去的交易(最典型的就是期初持股填了幾個月前的持有起始日),
 * 那天到今天之間的快照就會一直停留在舊值,趨勢圖上留下一道永久的斷崖。
 *
 * 這支不排程,需要時手動跑:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run backfill
 * 或到 GitHub repo 的 Actions 分頁執行「回填歷史資產快照」。
 *
 * 抓到的歷史收盤價會一併寫進 stock_price_history,所以重跑第二次幾乎不用再連外網。
 */

import { pathToFileURL } from 'node:url';
import { db, explainWriteError } from './db.ts';
import { carryForward, computeSnapshotRows, eachDay } from '../lib/snapshots.ts';
import {
  clearSnapshotsOutside,
  loadSnapshotSources,
  replaceSnapshots,
} from './snapshot-data.ts';
import { fetchTwHistory, fetchUsHistory, fetchUsdTwdHistory } from './providers.ts';

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

/**
 * 月檔之間的間隔。
 *
 * 證交所大約是每 5 秒 3 次,超過就擋。2 秒等於每 5 秒 2.5 次,留一點餘裕 ——
 * 被擋的月份只會印一行警告然後繼續,結果是安靜地少掉那段資料,寧可慢一點。
 */
const TWSE_GAP_MS = 2000;

function log(msg: string) {
  console.log(msg);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 區間內用得到的月份,YYYYMM */
function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  const cursor = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);

  while (cursor <= end) {
    months.push(`${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

/** 最早一筆交易的日期 —— 回填的起點 */
function earliestDate(dates: string[]): string | null {
  let earliest: string | null = null;
  for (const d of dates) {
    if (d && (earliest === null || d < earliest)) earliest = d;
  }
  return earliest;
}

async function main() {
  log(`=== 歷史回填(至 ${today},台北時間)===\n`);

  const sources = await loadSnapshotSources();
  if (!sources) {
    log('還沒有設定家庭的使用者,沒有東西可以回填');
    return;
  }

  const from = earliestDate([
    ...sources.stockTxns.map((t) => t.transaction_date),
    ...sources.accountTxns.map((t) => t.transaction_date),
  ]);

  if (!from) {
    log('還沒有任何交易紀錄,沒有東西可以回填');
    return;
  }
  if (from > today) {
    log(`最早的交易日期是 ${from},比今天還晚,沒有東西可以回填`);
    return;
  }

  const days = eachDay(from, today);
  const months = monthsBetween(from, today);
  log(`區間:${from} → ${today}(${days.length} 天,${months.length} 個月)\n`);

  // --- 1. 歷史收盤價 -------------------------------------------------------
  const { data: stocks, error: stockError } = await db()
    .from('stocks')
    .select('symbol, market, currency');
  if (stockError) throw new Error(`讀取股票清單失敗:${stockError.message}`);

  const symbols = stocks ?? [];
  const pricesBySymbol = new Map<string, Map<string, number>>();
  const priceRows: { symbol: string; price_date: string; close_price: number }[] = [];

  log(`[1/3] 抓歷史收盤價(${symbols.length} 檔)`);
  for (const s of symbols) {
    const raw =
      s.market === 'TW'
        ? await fetchTwHistory(s.symbol, months, () => sleep(TWSE_GAP_MS))
        : await fetchUsHistory(s.symbol, from, today);

    for (const [date, close] of raw) {
      priceRows.push({ symbol: s.symbol, price_date: date, close_price: close });
    }

    // 週末與假日沿用最近一次收盤價 —— 那正是那幾天的實際市值
    const filled = carryForward(raw, days);
    pricesBySymbol.set(s.symbol, filled);

    /*
     * 報出涵蓋率,而不是只報抓到幾個交易日。
     *
     * 來源被擋或某個月落空時,那幾天會安靜地退回成本價估算 —— 整支腳本
     * 仍然「成功」,只是曲線有一段是平的。把缺口攤開來才看得見。
     */
    const missing = days.length - filled.size;
    if (raw.size === 0) {
      console.warn(`  ${s.symbol}:完全抓不到歷史報價,整段回填期間都會用成本價估算`);
    } else if (missing > 0) {
      console.warn(
        `  ${s.symbol}:${raw.size} 個交易日,但有 ${missing} 天沒有價格` +
          `(多半是第一個收盤日之前),那幾天用成本價估算`
      );
    } else {
      log(`  ${s.symbol}:${raw.size} 個交易日,${days.length} 天全部有價格`);
    }
  }

  if (priceRows.length > 0) {
    const CHUNK = 1000;
    for (let i = 0; i < priceRows.length; i += CHUNK) {
      const { error } = await db()
        .from('stock_price_history')
        .upsert(
          priceRows.slice(i, i + CHUNK).map((r) => ({ ...r, updated_at: new Date().toISOString() })),
          { onConflict: 'symbol,price_date' }
        );
      if (error) throw explainWriteError(error, '寫入歷史股價');
    }
    log(`  寫入 stock_price_history:${priceRows.length} 列`);
  }

  // --- 2. 歷史匯率 ---------------------------------------------------------
  const hasUsd =
    symbols.some((s) => s.currency === 'USD') ||
    sources.accounts.some((a) => a.currency === 'USD');

  let fxByDate = new Map<string, number>();
  if (hasUsd) {
    log('\n[2/3] 抓歷史匯率');
    const raw = await fetchUsdTwdHistory(from, today);
    fxByDate = carryForward(raw, days);
    log(`  USD/TWD:${raw.size} 個交易日`);
    if (raw.size === 0) {
      console.warn('  抓不到歷史匯率,美元資產在回填期間會以 1:1 計入 —— 數字會失真');
    }
  } else {
    log('\n[2/3] 沒有任何美元資產,跳過匯率');
  }

  // --- 3. 逐日重算快照 -----------------------------------------------------
  log('\n[3/3] 重算每日快照');
  const rows = days.flatMap((day) =>
    computeSnapshotRows(
      sources,
      day,
      (symbol) => pricesBySymbol.get(symbol)?.get(day) ?? null,
      fxByDate.get(day) ?? 1
    )
  );

  /*
   * 先清掉區間以外的快照。
   *
   * 把最早一筆交易的日期往後改之後,舊區間前面那段會變成孤兒 ——
   * 那些日子其實你還沒持有任何東西,留著趨勢圖就會有一段憑空的資產。
   */
  await clearSnapshotsOutside(from, today);
  await replaceSnapshots(days, rows);
  log(`  ${days.length} 天 × ${sources.profiles.length} 位成員 + 家庭合計 = ${rows.length} 列`);
  log(`  ${from} 之前與 ${today} 之後的舊快照已清除`);

  log('\n完成');
}

// 只有直接執行這支腳本時才跑,被測試 import 時不會有副作用
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('\n回填失敗:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

export { monthsBetween, earliestDate };
