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

const TWSE_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';

interface TwseRow {
  Date: string;
  Code: string;
  Name: string;
  ClosingPrice: string;
}

/** 證交所每日收盤行情:一次拿回全部上市股票 */
export async function fetchTwseCloses(): Promise<Map<string, PriceRow>> {
  const rows = await fetchJson<TwseRow[]>(TWSE_URL);

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
// 台股 — 指定日期的正式收盤行情(當天收盤後就有)
// ---------------------------------------------------------------------------

const TWSE_DAILY_URL = 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX';
const TPEX_DAILY_URL = 'https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes';

interface ExchangeTable {
  fields?: string[];
  data?: unknown[][];
}

interface ExchangeReport {
  stat?: string;
  date?: string;
  tables?: ExchangeTable[];
}

/**
 * 從交易所網站的報表格式裡挑出「代號 → 收盤價」。
 *
 * 報表裡有好幾張表(大盤指數、類股漲跌…),欄位名稱對得上的才是個股行情;
 * 靠欄位名稱找位置,而不是寫死第幾欄,交易所改版時比較不會默默讀錯欄。
 *
 * 回應的日期跟要求的不一樣時整份不用 —— 寧可沒有,也不要把別天的價格記成這一天。
 */
function parseExchangeReport(
  report: ExchangeReport,
  date: string,
  codeField: string,
  closeField: string
): Map<string, PriceRow> {
  const map = new Map<string, PriceRow>();
  if (report.date && report.date !== date.replace(/-/g, '')) return map;

  for (const table of report.tables ?? []) {
    const fields = table.fields ?? [];
    const codeAt = fields.indexOf(codeField);
    const closeAt = fields.indexOf(closeField);
    if (codeAt < 0 || closeAt < 0) continue;

    for (const row of table.data ?? []) {
      const code = String(row[codeAt] ?? '').trim();
      const close = toNumber(row[closeAt]);
      // 當天沒成交的收盤價是 '--',略過而不是記成 0
      if (!code || close === null) continue;
      map.set(code, { symbol: code, price_date: date, close_price: close });
    }
  }
  return map;
}

/**
 * 證交所「每日收盤行情」:指定日期的全部上市股票(含 ETF)正式收盤價。
 *
 * 這是當日收盤價的主要來源。openapi 的 STOCK_DAY_ALL 實測要到**隔天早上**才更新
 * (2026-09-30 晚上 22:51 還停在 9/29),這份則是當天收盤後就有。
 * 沒開盤的日子回傳空的 map,不會拿別天的資料頂替。
 */
export async function fetchTwseDaily(date: string): Promise<Map<string, PriceRow>> {
  const report = await fetchJson<ExchangeReport>(
    `${TWSE_DAILY_URL}?date=${date.replace(/-/g, '')}&type=ALLBUT0999&response=json`,
    40000
  );
  return parseExchangeReport(report, date, '證券代號', '收盤價');
}

/** 櫃買中心「上櫃股票行情」:指定日期的全部上櫃股票正式收盤價。沒開盤的日子是空的 */
export async function fetchTpexDaily(date: string): Promise<Map<string, PriceRow>> {
  const report = await fetchJson<ExchangeReport>(
    `${TPEX_DAILY_URL}?date=${encodeURIComponent(date.replace(/-/g, '/'))}&id=&response=json`,
    40000
  );
  return parseExchangeReport(report, date, '代號', '收盤');
}

// ---------------------------------------------------------------------------
// 台股 — 櫃買中心(上櫃)
// ---------------------------------------------------------------------------

interface TpexRow {
  Date: string;
  SecuritiesCompanyCode: string;
  CompanyName: string;
  Close: string;
}

/** 櫃買中心每日收盤行情:一次拿回全部上櫃股票 */
export async function fetchTpexCloses(): Promise<Map<string, PriceRow>> {
  const rows = await fetchJson<TpexRow[]>(TPEX_URL);

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
// 台股 — 代號字典(新增交易時的自動完成用)
// ---------------------------------------------------------------------------

export interface SymbolRow {
  symbol: string;
  market: 'TW' | 'US';
  name: string;
}

/**
 * 認購/認售權證,不收進字典。
 *
 * 證交所與櫃買的每日行情把權證也一起回了,數量是一般股票的五倍
 * (9,927 vs 1,984),留著會把自動完成的下拉選單洗版 —— 打「閎康」時,
 * 真正的 3587 後面會跟著七檔它的權證,八格就滿了。
 *
 * 代號形狀是七開頭的六碼:認購全是數字(705595 閎康元大59購01),
 * 認售則以 U 結尾(72328U 環球晶群益59售01)。只認形狀不看名稱:
 *   - 2945 三商家購、3085 新零售 這種正常股票的名字裡就有「購」「售」
 *   - 七開頭但四碼的是正常股票(7402 LINEPAY、7769 鴻勁)
 *   - 零開頭與九開頭的六碼是 ETF 與 DR(006201、00686R、神州-DR)
 *
 * 對整份實際資料驗證過:符合這個形狀的 9,927 筆名稱 100% 都是權證命名,
 * 而形狀不符的 2,394 筆裡沒有任何一筆是權證 —— 沒有誤刪也沒有漏網。
 */
function isWarrant(symbol: string): boolean {
  return /^7\d{4}[0-9A-Z]$/.test(symbol);
}

/**
 * 台股全市場的代號 → 名稱對照(上市 + 上櫃)。
 *
 * 用的是跟收盤價同樣的兩支端點,但刻意分開再打一次,不跟價格共用回應:
 * 這是「打代號自動帶名稱」的便利資料,不該有任何機會拖垮價格同步。
 * 兩邊各自 try,一邊掛掉還是回傳另一邊的結果。
 */
export async function fetchTwSymbols(): Promise<SymbolRow[]> {
  const found = new Map<string, SymbolRow>();

  try {
    const rows = await fetchJson<TwseRow[]>(TWSE_URL);
    for (const row of rows) {
      const symbol = row.Code?.trim();
      const name = row.Name?.trim();
      if (symbol && name && !isWarrant(symbol)) {
        found.set(symbol, { symbol, market: 'TW', name });
      }
    }
  } catch (err) {
    console.warn(`  證交所代號字典抓取失敗:${(err as Error).message}`);
  }

  try {
    const rows = await fetchJson<TpexRow[]>(TPEX_URL);
    for (const row of rows) {
      const symbol = row.SecuritiesCompanyCode?.trim();
      const name = row.CompanyName?.trim();
      // 上市優先:同一個代號兩邊都有時,不覆蓋證交所那份
      if (symbol && name && !isWarrant(symbol) && !found.has(symbol)) {
        found.set(symbol, { symbol, market: 'TW', name });
      }
    }
  } catch (err) {
    console.warn(`  櫃買中心代號字典抓取失敗:${(err as Error).message}`);
  }

  return [...found.values()];
}

// ---------------------------------------------------------------------------
// 台股 — 休市日
// ---------------------------------------------------------------------------

const TWSE_HOLIDAY_URL = 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule';

interface TwseHolidayRow {
  Name?: string;
  Date?: string;
}

export interface HolidayRow {
  market: 'TW' | 'US';
  holiday_date: string;
  name: string;
}

/**
 * 證交所的當年度市場行事曆。
 *
 * 這份行事曆除了休市日,還列了「國曆新年開始交易日」「農曆春節前最後交易日」
 * 這種**有開盤**的日子,名稱都以「交易日」結尾,要濾掉。
 * 春節前那兩天「市場無交易,僅辦理結算交割作業」沒有交易,要留著。
 */
export async function fetchTwHolidays(): Promise<HolidayRow[]> {
  const rows = await fetchJson<TwseHolidayRow[]>(TWSE_HOLIDAY_URL);
  const found = new Map<string, HolidayRow>();

  for (const row of rows) {
    const date = rocToIso(String(row.Date ?? ''));
    const name = (row.Name ?? '').replace(/\s*\/\s*/g, '/').trim();
    if (!date || !name || name.endsWith('交易日')) continue;
    found.set(date, { market: 'TW', holiday_date: date, name });
  }

  return [...found.values()];
}

// ---------------------------------------------------------------------------
// 台股 — 除權除息預告(「待確認配息」用)
// ---------------------------------------------------------------------------

const TWSE_EXRIGHTS_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL';
const TPEX_EXRIGHTS_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost';

export interface CorporateActionRow {
  market: 'TW' | 'US';
  symbol: string;
  ex_date: string;
  /** 每股現金股利;有除息但金額還沒公布是 null(ETF 常常除息前幾天才公布) */
  cash_dividend: number | null;
  /** 每股配幾股:0.05 = 每千股配 50 股。沒有配股是 null */
  stock_ratio: number | null;
}

/**
 * 預告表的一列 → 一筆除權息。
 *
 * - 類型有「息」才有現金股利;金額欄是空白或文字(櫃買會寫「尚未公告」)時記成 null
 * - 配股率大於 0 才算配股
 * - 兩者都沒有的(只有「權」而且是現金增資認股)不是股利,略過
 */
function toCorporateAction(
  symbol: string,
  rocDate: string,
  kind: string,
  cashRaw: unknown,
  ratioRaw: unknown
): CorporateActionRow | null {
  const code = symbol.trim();
  const exDate = rocToIso(rocDate);
  if (!code || !exDate) return null;

  const hasCash = kind.includes('息');
  const cash = hasCash ? toNumber(cashRaw) : null;
  const ratio = toNumber(ratioRaw);
  const stock = ratio !== null && ratio > 0 ? ratio : null;

  if (!hasCash && stock === null) return null;
  return {
    market: 'TW',
    symbol: code,
    ex_date: exDate,
    cash_dividend: cash !== null && cash > 0 ? cash : null,
    stock_ratio: stock,
  };
}

interface TwseExRightsRow {
  Date?: string;
  Code?: string;
  Exdividend?: string;
  StockDividendRatio?: string;
  CashDividend?: string;
}

/** 證交所「除權除息預告表」:大約前一週到後一個月的上市股票與 ETF */
export async function fetchTwseCorporateActions(): Promise<CorporateActionRow[]> {
  const rows = await fetchJson<TwseExRightsRow[]>(TWSE_EXRIGHTS_URL);
  return rows
    .map((r) =>
      toCorporateAction(r.Code ?? '', r.Date ?? '', r.Exdividend ?? '', r.CashDividend, r.StockDividendRatio)
    )
    .filter((r): r is CorporateActionRow => r !== null);
}

interface TpexExRightsRow {
  // 欄位名稱就是拼成 Rrights,不是打錯
  ExRrightsExDividendDate?: string;
  SecuritiesCompanyCode?: string;
  ExRrightsExDividend?: string;
  StockDividendRatio?: string;
  CashDividend?: string;
}

/** 櫃買中心「除權除息預告表」:上櫃股票與債券 ETF(例如 00687B) */
export async function fetchTpexCorporateActions(): Promise<CorporateActionRow[]> {
  const rows = await fetchJson<TpexExRightsRow[]>(TPEX_EXRIGHTS_URL);
  return rows
    .map((r) =>
      toCorporateAction(
        r.SecuritiesCompanyCode ?? '',
        r.ExRrightsExDividendDate ?? '',
        r.ExRrightsExDividend ?? '',
        r.CashDividend,
        r.StockDividendRatio
      )
    )
    .filter((r): r is CorporateActionRow => r !== null);
}

// ---------------------------------------------------------------------------
// 歷史收盤價(回填用)
// ---------------------------------------------------------------------------

const TWSE_MONTH_URL = 'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY';
const TPEX_MONTH_URL = 'https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock';

/** 兩邊的每日列都是 [日期, ..., 開, 高, 低, 收, ...],收盤價固定在 index 6 */
const CLOSE_INDEX = 6;

function collectMonthRows(rows: unknown, into: Map<string, number>): void {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const date = rocToIso(String(row[0] ?? ''));
    const close = toNumber(row[CLOSE_INDEX]);
    if (date && close !== null) into.set(date, close);
  }
}

/**
 * 台股某一檔的歷史收盤價。`months` 是 YYYYMM 字串陣列,一個月一次請求。
 *
 * 先把所有月份都跟證交所要;整批都沒有資料才改問櫃買 —— 一檔股票不會既上市
 * 又上櫃,所以用「全部落空」來判斷比每個月各試兩次省一半請求。
 *
 * 呼叫端要自己控制節奏:證交所對連續請求會擋。
 */
export async function fetchTwHistory(
  symbol: string,
  months: string[],
  onRequest?: () => Promise<void>
): Promise<Map<string, number>> {
  const closes = new Map<string, number>();

  for (const ym of months) {
    if (onRequest) await onRequest();
    try {
      const json = await fetchJson<{ stat?: string; data?: unknown }>(
        `${TWSE_MONTH_URL}?date=${ym}01&stockNo=${encodeURIComponent(symbol)}&response=json`
      );
      if (json.stat === 'OK') collectMonthRows(json.data, closes);
    } catch (err) {
      console.warn(`  證交所 ${symbol} ${ym} 抓取失敗:${(err as Error).message}`);
    }
  }

  if (closes.size > 0) return closes;

  // 證交所整批落空 → 改當成上櫃
  for (const ym of months) {
    if (onRequest) await onRequest();
    try {
      const json = await fetchJson<{ tables?: { data?: unknown }[] }>(
        `${TPEX_MONTH_URL}?code=${encodeURIComponent(symbol)}` +
          `&date=${ym.slice(0, 4)}/${ym.slice(4)}/01&response=json`
      );
      for (const table of json.tables ?? []) collectMonthRows(table.data, closes);
    } catch (err) {
      console.warn(`  櫃買 ${symbol} ${ym} 抓取失敗:${(err as Error).message}`);
    }
  }

  return closes;
}

interface YahooHistory {
  chart: {
    result?: Array<{
      timestamp?: number[];
      indicators: { quote: Array<{ close?: (number | null)[] }> };
    }>;
  };
}

/** Yahoo 的區間查詢:一次請求就拿回整段,美股與匯率共用 */
async function fetchYahooRange(
  ticker: string,
  from: string,
  to: string
): Promise<Map<string, number>> {
  const period1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
  // 多要一天,避免時區把最後一天切掉
  const period2 = Math.floor(Date.parse(`${to}T00:00:00Z`) / 1000) + 86400;

  const out = new Map<string, number>();
  const data = await fetchJson<YahooHistory>(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
      `?interval=1d&period1=${period1}&period2=${period2}`
  );

  const result = data.chart?.result?.[0];
  if (!result) return out;

  const stamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  for (let i = 0; i < stamps.length; i += 1) {
    const close = closes[i];
    if (close == null) continue;
    out.set(new Date(stamps[i] * 1000).toISOString().slice(0, 10), close);
  }
  return out;
}

/** 美股某一檔的歷史收盤價 */
export async function fetchUsHistory(
  symbol: string,
  from: string,
  to: string
): Promise<Map<string, number>> {
  try {
    return await fetchYahooRange(symbol, from, to);
  } catch (err) {
    console.warn(`  Yahoo 抓 ${symbol} 歷史失敗:${(err as Error).message}`);
    return new Map();
  }
}

/**
 * 美元兌台幣的歷史匯率。
 *
 * 走 Yahoo 的 TWD=X —— 一次請求拿回整段,而且跟美股共用同一條解析路徑。
 * (每日同步用的 open.er-api 與 Frankfurter 都只給當下的匯率,沒有區間查詢。)
 */
export async function fetchUsdTwdHistory(
  from: string,
  to: string
): Promise<Map<string, number>> {
  try {
    return await fetchYahooRange('TWD=X', from, to);
  } catch (err) {
    console.warn(`  Yahoo 抓歷史匯率失敗:${(err as Error).message}`);
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// 美股
// ---------------------------------------------------------------------------

interface YahooChart {
  chart: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        regularMarketTime?: number;
        /** 交易所時區相對 UTC 的秒數,台股 28800、美股夏令 -14400 */
        gmtoffset?: number;
        currentTradingPeriod?: { regular?: { start: number; end: number } };
      };
      timestamp?: number[];
      indicators: { quote: Array<{ close?: (number | null)[] }> };
    }>;
    error?: unknown;
  };
}

/**
 * Yahoo 的最新收盤價。
 *
 * `ticker` 是 Yahoo 的代號(美股直接用,台股要加 .TW / .TWO),
 * `reportAs` 是要記進資料庫的代號 —— 台股兩者不一樣。
 */
async function fetchYahooLatest(
  ticker: string,
  reportAs: string,
  now: number
): Promise<PriceRow | null> {
  const data = await fetchJson<YahooChart>(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`
  );

  const result = data.chart?.result?.[0];
  if (!result) return null;

  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const stamps = result.timestamp ?? [];

  // 日期以交易所當地時間為準,不是 UTC
  const offset = result.meta?.gmtoffset ?? 0;
  const localDate = (sec: number) => new Date((sec + offset) * 1000).toISOString().slice(0, 10);

  /*
   * 還在交易中、或剛收盤還沒定案的那一根,它的 close 其實是**盤中即時價**。
   * 早上那班排程常常延到 9 點開盤後才跑,不擋的話會把盤中價當成當天收盤價寫進去。
   * 收盤後多等 15 分鐘(台股 13:25~13:30 是收盤集合競價,結果要一點時間才定)。
   */
  const regular = result.meta?.currentTradingPeriod?.regular;
  const unsettledDay =
    regular && now / 1000 < regular.end + YAHOO_SETTLE_SECONDS ? localDate(regular.start) : null;

  for (let i = closes.length - 1; i >= 0; i -= 1) {
    const close = closes[i];
    if (close == null || stamps[i] == null) continue;

    const day = localDate(stamps[i]);
    if (day === unsettledDay) continue;

    return { symbol: reportAs, price_date: day, close_price: close };
  }
  return null;
}

/** 收盤後多久才相信 Yahoo 的收盤價 */
const YAHOO_SETTLE_SECONDS = 15 * 60;

/** Yahoo 的台股代號後綴:上市 .TW、上櫃 .TWO */
export type TwBoard = 'TW' | 'TWO';

/**
 * 台股逐檔報價,用來補大盤每日檔案的延遲。
 *
 * 證交所的 STOCK_DAY_ALL 實測到台北時間晚上九點還停在前一個交易日,櫃買也
 * 不見得趕得上 14:30 的排程。光靠它們的話,當天的盈虧要等隔天早上那班才補得上。
 * Yahoo 收盤後幾分鐘就有資料,拿它把當天補齊。
 *
 * 知道是上市還上櫃就只試那一個,不確定就兩個都試。
 */
export async function fetchTwQuote(
  symbol: string,
  board?: TwBoard,
  now: number = Date.now()
): Promise<PriceRow | null> {
  for (const suffix of board ? [board] : (['TW', 'TWO'] as const)) {
    try {
      const row = await fetchYahooLatest(`${symbol}.${suffix}`, symbol, now);
      if (row) return row;
    } catch (err) {
      console.warn(`  Yahoo 抓 ${symbol}.${suffix} 失敗:${(err as Error).message}`);
    }
  }
  return null;
}

/** 美股 16:00 收盤,多等 15 分鐘才相信當天的收盤價(紐約時間,從午夜起算的分鐘數) */
const US_CLOSE_SETTLED_MINUTES = 16 * 60 + 15;

/**
 * 台股 13:30 收盤(13:25~13:30 是收盤集合競價),證交所約 14:00 後公布當日行情。
 * 台北時間 14:00 以前,任何來源給的「今天」價格都當成盤中價。
 */
const TW_CLOSE_SETTLED_MINUTES = 14 * 60;

/** 某個時區的當地日期與時間(從午夜起算的分鐘數)—— 夏令時間由 Intl 處理 */
function marketClock(now: number, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** 紐約當地的日期與時間 */
export function newYorkClock(now: number): { date: string; minutes: number } {
  return marketClock(now, 'America/New_York');
}

/**
 * 這個日期的收盤價在 `now` 這一刻定案了沒 —— **只看時鐘,不看資料來源說什麼**。
 *
 * 同步寫入資料庫前最後一道關卡:當地還沒收盤(或剛收盤、收盤價還沒定)時,
 * 「今天」的價格一律不寫,不管它來自哪裡。資料來源本身的判斷(Yahoo 的交易時段)
 * 萬一哪天缺欄位或出錯,這一關仍然擋得住盤中價。
 *
 * 過去的日期一律算定案;未來的日期(時區算錯之類)一律不收。
 */
export function isCloseSettled(market: 'TW' | 'US', priceDate: string, now: number): boolean {
  const { date, minutes } =
    market === 'US' ? marketClock(now, 'America/New_York') : marketClock(now, 'Asia/Taipei');
  if (priceDate < date) return true;
  if (priceDate > date) return false;
  return minutes >= (market === 'US' ? US_CLOSE_SETTLED_MINUTES : TW_CLOSE_SETTLED_MINUTES);
}

/** 先試 Yahoo Finance,失敗再退到 Stooq */
export async function fetchUsClose(
  symbol: string,
  now: number = Date.now()
): Promise<PriceRow | null> {
  try {
    const row = await fetchYahooLatest(symbol, symbol, now);
    if (row) return row;
  } catch (err) {
    console.warn(`  Yahoo 抓 ${symbol} 失敗(${(err as Error).message}),改試 Stooq`);
  }

  // 備援:Stooq 的 CSV(Date,Open,High,Low,Close,Volume)
  try {
    const csv = await fetchText(
      `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase())}.us&i=d`
    );
    const lines = csv.trim().split('\n').slice(1);

    // Stooq 的日線在美股交易時段會附上當天還沒收盤的那一列,要略過
    const { date: nyDate, minutes: nyMinutes } = newYorkClock(now);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const cols = lines[i].split(',');
      const close = toNumber(cols[4]);
      if (close === null || !/^\d{4}-\d{2}-\d{2}$/.test(cols[0])) continue;
      if (cols[0] === nyDate && nyMinutes < US_CLOSE_SETTLED_MINUTES) continue;
      return { symbol, price_date: cols[0], close_price: close };
    }
    return null;
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
