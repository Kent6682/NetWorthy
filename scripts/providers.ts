/**
 * 市場資料來源
 *
 * 全部都是免費、不需要申請金鑰的公開介面。每個來源都有備援,
 * 單一來源掛掉不會讓整份同步失敗。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchJson<T>(url: string, timeoutMs = 20000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string, timeoutMs = 20000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 民國日期字串 1150818 → 2026-08-18 */
export function rocToIso(roc: string): string | null {
  const trimmed = roc.trim().replace(/\//g, '');
  if (trimmed.length < 6) return null;
  const year = Number(trimmed.slice(0, trimmed.length - 4)) + 1911;
  const month = trimmed.slice(-4, -2);
  const day = trimmed.slice(-2);
  if (!Number.isFinite(year)) return null;
  return `${year}-${month}-${day}`;
}

function toNumber(raw: unknown): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const cleaned = String(raw).replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '--' || cleaned === '---') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export interface PriceRow {
  symbol: string;
  price_date: string;
  close_price: number;
}

// ---------------------------------------------------------------------------
// 台股 — 證交所(上市)
// ---------------------------------------------------------------------------

interface TwseRow {
  Date: string;
  Code: string;
  Name: string;
  ClosingPrice: string;
}

/** 證交所每日收盤行情:一次拿回全部上市股票 */
export async function fetchTwseCloses(): Promise<Map<string, PriceRow>> {
  const rows = await fetchJson<TwseRow[]>(
    'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
  );

  const map = new Map<string, PriceRow>();
  for (const row of rows) {
    const close = toNumber(row.ClosingPrice);
    const date = rocToIso(row.Date);
    if (close === null || !date) continue;
    map.set(row.Code.trim(), { symbol: row.Code.trim(), price_date: date, close_price: close });
  }
  return map;
}

// ---------------------------------------------------------------------------
// 台股 — 櫃買中心(上櫃)
// ---------------------------------------------------------------------------

interface TpexRow {
  Date: string;
  SecuritiesCompanyCode: string;
  Close: string;
}

/** 櫃買中心每日收盤行情:一次拿回全部上櫃股票 */
export async function fetchTpexCloses(): Promise<Map<string, PriceRow>> {
  const rows = await fetchJson<TpexRow[]>(
    'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'
  );

  const map = new Map<string, PriceRow>();
  for (const row of rows) {
    const close = toNumber(row.Close);
    const date = rocToIso(row.Date);
    const code = row.SecuritiesCompanyCode?.trim();
    if (close === null || !date || !code) continue;
    map.set(code, { symbol: code, price_date: date, close_price: close });
  }
  return map;
}

// ---------------------------------------------------------------------------
// 美股
// ---------------------------------------------------------------------------

interface YahooChart {
  chart: {
    result?: Array<{
      meta: { regularMarketPrice?: number; regularMarketTime?: number };
      timestamp?: number[];
      indicators: { quote: Array<{ close?: (number | null)[] }> };
    }>;
    error?: unknown;
  };
}

/** 先試 Yahoo Finance,失敗再退到 Stooq */
export async function fetchUsClose(symbol: string): Promise<PriceRow | null> {
  try {
    const data = await fetchJson<YahooChart>(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`
    );
    const result = data.chart?.result?.[0];
    if (result) {
      const closes = result.indicators?.quote?.[0]?.close ?? [];
      const stamps = result.timestamp ?? [];
      for (let i = closes.length - 1; i >= 0; i -= 1) {
        const close = closes[i];
        if (close != null && stamps[i] != null) {
          return {
            symbol,
            price_date: new Date(stamps[i] * 1000).toISOString().slice(0, 10),
            close_price: close,
          };
        }
      }
    }
  } catch (err) {
    console.warn(`  Yahoo 抓 ${symbol} 失敗(${(err as Error).message}),改試 Stooq`);
  }

  // 備援:Stooq 的 CSV(Date,Open,High,Low,Close,Volume)
  try {
    const csv = await fetchText(
      `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase())}.us&i=d`
    );
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return null;
    const last = lines[lines.length - 1].split(',');
    const close = toNumber(last[4]);
    if (close === null || !/^\d{4}-\d{2}-\d{2}$/.test(last[0])) return null;
    return { symbol, price_date: last[0], close_price: close };
  } catch (err) {
    console.warn(`  Stooq 抓 ${symbol} 也失敗:${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 匯率
// ---------------------------------------------------------------------------

export interface FxRow {
  rate_date: string;
  from_currency: string;
  to_currency: string;
  rate: number;
}

/** 美元兌台幣:先試 open.er-api.com,失敗再退到 Frankfurter */
export async function fetchUsdTwd(): Promise<FxRow | null> {
  try {
    const data = await fetchJson<{
      result: string;
      time_last_update_unix: number;
      rates: Record<string, number>;
    }>('https://open.er-api.com/v6/latest/USD');

    const rate = data.rates?.TWD;
    if (data.result === 'success' && typeof rate === 'number') {
      return {
        rate_date: new Date(data.time_last_update_unix * 1000).toISOString().slice(0, 10),
        from_currency: 'USD',
        to_currency: 'TWD',
        rate,
      };
    }
  } catch (err) {
    console.warn(`  open.er-api 抓匯率失敗(${(err as Error).message}),改試 Frankfurter`);
  }

  try {
    const data = await fetchJson<{ date: string; rate: number }>(
      'https://api.frankfurter.dev/v2/rate/USD/TWD'
    );
    if (typeof data.rate === 'number') {
      return {
        rate_date: data.date,
        from_currency: 'USD',
        to_currency: 'TWD',
        rate: data.rate,
      };
    }
  } catch (err) {
    console.warn(`  Frankfurter 抓匯率也失敗:${(err as Error).message}`);
  }

  return null;
}
