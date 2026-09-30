/**
 * 用各來源的真實回應格式做 fixture,驗證解析邏輯。
 * 這裡不連外網,把 global fetch 換成假的。
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchTwseCloses,
  fetchTwseDaily,
  fetchTpexCloses,
  fetchTpexDaily,
  fetchUsClose,
  newYorkClock,
  fetchTwHolidays,
  fetchTwQuote,
  fetchTwSymbols,
  fetchUsdTwd,
} from '../scripts/providers.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubJson(payload: unknown, ok = true, status = 200) {
  globalThis.fetch = (async () =>
    ({
      ok,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    }) as unknown as Response) as typeof fetch;
}

test('證交所回應解析(真實欄位格式)', async () => {
  stubJson([
    {
      Date: '1150818',
      Code: '2330',
      Name: '台積電',
      TradeVolume: '31234567',
      TradeValue: '38000000000',
      OpeningPrice: '1215.00',
      HighestPrice: '1230.00',
      LowestPrice: '1210.00',
      ClosingPrice: '1,225.00',
      Change: '10.0000',
      Transaction: '45678',
    },
    // 停牌之類沒有收盤價的,要被略過而不是變成 0
    { Date: '1150818', Code: '9999', Name: '測試', ClosingPrice: '--' },
  ]);

  const map = await fetchTwseCloses();
  assert.equal(map.size, 1, '沒有收盤價的股票不應該寫進來');

  const tsmc = map.get('2330');
  assert.equal(tsmc?.price_date, '2026-08-18', '民國日期要轉成西元');
  assert.equal(tsmc?.close_price, 1225, '含千分位逗號的價格要正確解析');
});

test('櫃買中心回應解析', async () => {
  stubJson([
    { Date: '1150818', SecuritiesCompanyCode: '6488', Close: '985.00' },
    { Date: '1150818', SecuritiesCompanyCode: ' 5483 ', Close: '112.5' },
    { Date: '1150818', SecuritiesCompanyCode: '0000', Close: '' },
  ]);

  const map = await fetchTpexCloses();
  assert.equal(map.size, 2);
  assert.equal(map.get('6488')?.close_price, 985);
  assert.equal(map.get('5483')?.close_price, 112.5, '代號前後的空白要去掉');
  assert.equal(map.get('0000'), undefined, '空的收盤價要略過');
});

test('代號字典:上市與上櫃合併,同代號以證交所為準', async () => {
  let call = 0;
  globalThis.fetch = (async () => {
    call += 1;
    const payload =
      call === 1
        ? [
            { Date: '1150818', Code: '2330', Name: '台積電', ClosingPrice: '1225.00' },
            { Date: '1150818', Code: ' 0050 ', Name: ' 元大台灣50 ', ClosingPrice: '200' },
            // 沒有名稱的不該進字典,否則下拉選單會出現空白列
            { Date: '1150818', Code: '9998', Name: '', ClosingPrice: '10' },
          ]
        : [
            { Date: '1150818', SecuritiesCompanyCode: '6488', CompanyName: '環球晶', Close: '985' },
            { Date: '1150818', SecuritiesCompanyCode: '2330', CompanyName: '不該蓋掉', Close: '1' },
          ];
    return { ok: true, status: 200, json: async () => payload } as unknown as Response;
  }) as typeof fetch;

  const rows = await fetchTwSymbols();
  const byCode = new Map(rows.map((r) => [r.symbol, r.name]));

  assert.equal(call, 2, '上市與上櫃都要抓');
  assert.equal(byCode.get('2330'), '台積電', '同一個代號兩邊都有時,以證交所那份為準');
  assert.equal(byCode.get('0050'), '元大台灣50', '代號與名稱前後的空白要去掉');
  assert.equal(byCode.get('6488'), '環球晶');
  assert.equal(byCode.has('9998'), false, '沒有名稱的要略過');
  assert.ok(
    rows.every((r) => r.market === 'TW'),
    '這兩個來源都是台股'
  );
});

test('代號字典:濾掉權證,但不能誤傷長得像的正常標的', async () => {
  let call = 0;
  globalThis.fetch = (async () => {
    call += 1;
    const payload =
      call === 1
        ? [
            { Date: '1150818', Code: '2330', Name: '台積電', ClosingPrice: '1225' },
            // 認購權證:七開頭六碼全數字,要被濾掉
            { Date: '1150818', Code: '705595', Name: '閎康元大59購01', ClosingPrice: '1.2' },
            { Date: '1150818', Code: '704946', Name: '閎康統一72購01', ClosingPrice: '0.8' },
            // 認售權證:七開頭、U 結尾,一樣要濾掉
            { Date: '1150818', Code: '72328U', Name: '環球晶群益59售01', ClosingPrice: '0.5' },
            // 七開頭但只有四碼 —— 這是正常股票,要留著
            { Date: '1150818', Code: '7402', Name: 'LINEPAY', ClosingPrice: '520' },
            // 零開頭與九開頭的六碼是 ETF 與 DR,也要留著
            { Date: '1150818', Code: '006201', Name: '元大富櫃50', ClosingPrice: '43.12' },
            { Date: '1150818', Code: '00686R', Name: '群益臺灣加權反1', ClosingPrice: '8.4' },
            { Date: '1150818', Code: '910861', Name: '神州-DR', ClosingPrice: '2.1' },
            // 名字裡有「購」「售」的正常股票,不可以因為名稱被誤刪
            { Date: '1150818', Code: '2945', Name: '三商家購', ClosingPrice: '18' },
          ]
        : [{ Date: '1150818', SecuritiesCompanyCode: '712345', CompanyName: '某上櫃權證購01', Close: '1' }];
    return { ok: true, status: 200, json: async () => payload } as unknown as Response;
  }) as typeof fetch;

  const codes = (await fetchTwSymbols()).map((r) => r.symbol).sort();

  assert.deepEqual(
    codes,
    ['006201', '00686R', '2330', '2945', '7402', '910861'],
    '只有七開頭的六碼數字該被濾掉'
  );
});

test('代號字典:一邊的來源掛掉,仍然回傳另一邊', async () => {
  let call = 0;
  globalThis.fetch = (async () => {
    call += 1;
    if (call === 1) return { ok: false, status: 503 } as unknown as Response;
    return {
      ok: true,
      status: 200,
      json: async () => [
        { Date: '1150818', SecuritiesCompanyCode: '6488', CompanyName: '環球晶', Close: '985' },
      ],
    } as unknown as Response;
  }) as typeof fetch;

  const rows = await fetchTwSymbols();
  assert.equal(rows.length, 1, '證交所掛掉時還是要有上櫃的資料');
  assert.equal(rows[0].name, '環球晶');
});

test('休市日:只留沒有交易的日子,開始/最後交易日要濾掉', async () => {
  stubJson([
    { Name: '中華民國開國紀念日', Date: '1150101', Weekday: '四' },
    // 這兩種有開盤,不是休市日
    { Name: '國曆新年開始交易日', Date: '1150102', Weekday: '五' },
    { Name: '農曆春節前最後交易日', Date: '1150211', Weekday: '三' },
    // 沒有交易、只辦交割,要算休市
    { Name: '市場無交易，僅辦理結算交割作業', Date: '1150212', Weekday: '四' },
    { Name: '中秋節', Date: '1150925', Weekday: '五' },
    { Name: '孔子誕辰紀念日/ 教師節', Date: '1150928', Weekday: '一' },
  ]);

  const rows = await fetchTwHolidays();
  const byDate = new Map(rows.map((r) => [r.holiday_date, r.name]));

  assert.deepEqual(
    [...byDate.keys()].sort(),
    ['2026-01-01', '2026-02-12', '2026-09-25', '2026-09-28']
  );
  assert.equal(byDate.get('2026-09-25'), '中秋節');
  assert.equal(byDate.get('2026-09-28'), '孔子誕辰紀念日/教師節', '斜線前後的空白要收掉');
  assert.ok(rows.every((r) => r.market === 'TW'));
});

/** Yahoo chart 端點的回應形狀 */
function yahooChart(rows: [string, number | null][]) {
  return {
    chart: {
      result: [
        {
          timestamp: rows.map(([d]) => Date.parse(`${d}T00:00:00Z`) / 1000),
          indicators: { quote: [{ close: rows.map(([, c]) => c) }] },
        },
      ],
    },
  };
}

test('台股逐檔報價:記進資料庫的是原本的代號,不是 Yahoo 的 ticker', async () => {
  const seen: string[] = [];
  globalThis.fetch = (async (url: string) => {
    seen.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => yahooChart([['2026-09-07', 2460], ['2026-09-08', 2470]]),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const row = await fetchTwQuote('2330', 'TW');

  assert.equal(row?.symbol, '2330', '不能寫成 2330.TW');
  assert.equal(row?.price_date, '2026-09-08', '取最新一天');
  assert.equal(row?.close_price, 2470);
  assert.equal(seen.length, 1, '指定上市就只問一次');
  assert.match(seen[0], /2330\.TW\?/);
});

test('台股逐檔報價:沒指定上市櫃時,.TW 落空會再試 .TWO', async () => {
  const seen: string[] = [];
  globalThis.fetch = (async (url: string) => {
    seen.push(String(url));
    // 上市查無此檔,上櫃才有
    const empty = String(url).includes('.TW?');
    return {
      ok: true,
      status: 200,
      json: async () =>
        empty ? { chart: { result: [] } } : yahooChart([['2026-09-08', 28.5]]),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const row = await fetchTwQuote('00687B');

  assert.equal(row?.symbol, '00687B');
  assert.equal(row?.close_price, 28.5);
  assert.equal(seen.length, 2, '先試 .TW 再試 .TWO');
  assert.match(seen[1], /00687B\.TWO\?/);
});

test('台股逐檔報價:兩邊都抓不到時回 null,不要讓整份同步掛掉', async () => {
  globalThis.fetch = (async () => ({ ok: false, status: 404 }) as unknown as Response) as typeof fetch;
  assert.equal(await fetchTwQuote('9999'), null);
});

test('台股逐檔報價:略過還沒有收盤價的當天', async () => {
  // 盤中 Yahoo 可能給出當天但 close 是 null
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => yahooChart([['2026-09-07', 2460], ['2026-09-08', null]]),
    }) as unknown as Response) as typeof fetch;

  const row = await fetchTwQuote('2330', 'TW');
  assert.equal(row?.price_date, '2026-09-07', '往回取最後一個有收盤價的日子');
  assert.equal(row?.close_price, 2460);
});

test('匯率主來源 open.er-api 解析', async () => {
  stubJson({
    result: 'success',
    time_last_update_unix: Math.floor(Date.UTC(2026, 7, 18, 0, 2, 31) / 1000),
    base_code: 'USD',
    rates: { TWD: 31.8395, JPY: 147.2 },
  });

  const fx = await fetchUsdTwd();
  assert.equal(fx?.rate, 31.8395);
  assert.equal(fx?.rate_date, '2026-08-18');
  assert.equal(fx?.from_currency, 'USD');
  assert.equal(fx?.to_currency, 'TWD');
});

test('匯率主來源失敗時退到 Frankfurter', async () => {
  let call = 0;
  globalThis.fetch = (async () => {
    call += 1;
    if (call === 1) return { ok: false, status: 503 } as unknown as Response;
    return {
      ok: true,
      status: 200,
      json: async () => ({ date: '2026-08-04', base: 'USD', quote: 'TWD', rate: 32.346 }),
    } as unknown as Response;
  }) as typeof fetch;

  const fx = await fetchUsdTwd();
  assert.equal(call, 2, '主來源失敗後應該要試備援');
  assert.equal(fx?.rate, 32.346);
  assert.equal(fx?.rate_date, '2026-08-04');
});

test('兩個匯率來源都失敗時回傳 null', async () => {
  globalThis.fetch = (async () => ({ ok: false, status: 500 }) as unknown as Response) as typeof fetch;
  assert.equal(await fetchUsdTwd(), null);
});

// --- 指定日期的正式行情 -----------------------------------------------------

test('證交所每日收盤行情:從多張表裡找出個股那張,依欄位名稱取收盤價', async () => {
  stubJson({
    stat: 'OK',
    date: '20260929',
    tables: [
      // 大盤指數表:欄位對不上,要略過
      { fields: ['指數', '收盤指數'], data: [['發行量加權股價指數', '23,456.78']] },
      {
        fields: ['證券代號', '證券名稱', '成交股數', '成交筆數', '成交金額', '開盤價', '最高價', '最低價', '收盤價'],
        data: [
          ['00712', '復華富時不動產', '1', '1', '1', '7.8', '7.8', '7.5', '7.56'],
          ['2542', '興富發', '1', '1', '1', '39', '39', '38', '38.60'],
          ['2330', '台積電', '1', '1', '1', '1,230', '1,240', '1,220', '1,235.00'],
          // 當天沒成交:收盤價是 --,不能記成 0
          ['9999', '沒成交', '0', '0', '0', '--', '--', '--', '--'],
        ],
      },
    ],
  });

  const map = await fetchTwseDaily('2026-09-29');
  assert.equal(map.get('00712')?.close_price, 7.56);
  assert.equal(map.get('2542')?.price_date, '2026-09-29');
  assert.equal(map.get('2330')?.close_price, 1235, '千分位要去掉');
  assert.equal(map.has('9999'), false);
  assert.equal(map.size, 3);
});

test('證交所每日收盤行情:沒開盤的日子是空的', async () => {
  stubJson({ stat: '很抱歉,沒有符合條件的資料!' });
  assert.equal((await fetchTwseDaily('2026-09-28')).size, 0);
});

test('交易所回的日期跟要求的不一樣時整份不用,不能把別天的價格記成這一天', async () => {
  stubJson({
    stat: 'OK',
    date: '20260924',
    tables: [
      {
        fields: ['證券代號', '證券名稱', '收盤價'],
        data: [['00712', '復華富時不動產', '7.82']],
      },
    ],
  });
  assert.equal((await fetchTwseDaily('2026-09-29')).size, 0);
});

test('櫃買上櫃股票行情:代號與收盤欄位,代號前後空白去掉', async () => {
  stubJson({
    stat: 'ok',
    date: '20260929',
    tables: [
      {
        fields: ['代號', '名稱', '收盤', '漲跌', '開盤'],
        data: [
          ['00687B', '國泰20年美債', '25.67', '-0.61 ', '25.95'],
          [' 6488 ', '環球晶', '945.00', '-3.00', '940'],
        ],
      },
      { fields: ['代號', '名稱', '收盤'], data: [] },
    ],
  });
  const map = await fetchTpexDaily('2026-09-29');
  assert.equal(map.get('00687B')?.close_price, 25.67);
  assert.equal(map.get('6488')?.close_price, 945);
});

// --- Yahoo 不能把盤中價當收盤價 ---------------------------------------------

/** 帶交易時段資訊的 Yahoo 回應;時間都用台北時間描述 */
function yahooTw(rows: [string, number | null][], sessionDay: string) {
  const at = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00+08:00`) / 1000;
  return {
    chart: {
      result: [
        {
          meta: {
            gmtoffset: 28800,
            currentTradingPeriod: {
              regular: { start: at(sessionDay, '09:00'), end: at(sessionDay, '13:30') },
            },
          },
          // Yahoo 的台股日線時間戳是當地 09:00
          timestamp: rows.map(([d]) => at(d, '09:00')),
          indicators: { quote: [{ close: rows.map(([, c]) => c) }] },
        },
      ],
    },
  };
}

test('Yahoo:盤中的那一根是即時價,不能當成收盤價', async () => {
  stubJson(yahooTw([['2026-09-29', 7.56], ['2026-09-30', 7.6]], '2026-09-30'));
  // 9/30 早上 09:28(排程延遲後實際跑的時間),台股正在交易
  const row = await fetchTwQuote('00712', 'TW', Date.parse('2026-09-30T09:28:00+08:00'));
  assert.equal(row?.price_date, '2026-09-29', '要退回前一個已收盤的交易日');
  assert.equal(row?.close_price, 7.56);
});

test('Yahoo:收盤 15 分鐘後才採用當天的收盤價', async () => {
  const rows: [string, number][] = [
    ['2026-09-29', 7.56],
    ['2026-09-30', 7.54],
  ];

  stubJson(yahooTw(rows, '2026-09-30'));
  const tooEarly = await fetchTwQuote('00712', 'TW', Date.parse('2026-09-30T13:40:00+08:00'));
  assert.equal(tooEarly?.price_date, '2026-09-29', '13:40 收盤價還沒定案');

  stubJson(yahooTw(rows, '2026-09-30'));
  const settled = await fetchTwQuote('00712', 'TW', Date.parse('2026-09-30T20:50:00+08:00'));
  assert.equal(settled?.price_date, '2026-09-30');
  assert.equal(settled?.close_price, 7.54);
});

test('Yahoo:日期用交易所當地時間,不是 UTC', async () => {
  stubJson({
    chart: {
      result: [
        {
          meta: { gmtoffset: 28800 },
          // 台北 2026-09-30 07:00 = UTC 9/29 23:00:用 UTC 會錯成 9/29
          timestamp: [Date.parse('2026-09-30T07:00:00+08:00') / 1000],
          indicators: { quote: [{ close: [100] }] },
        },
      ],
    },
  });
  const row = await fetchTwQuote('2330', 'TW', Date.parse('2026-10-01T20:00:00+08:00'));
  assert.equal(row?.price_date, '2026-09-30');
});

test('Stooq:美股交易時段中,當天還沒收盤的那一列要略過', async () => {
  let call = 0;
  globalThis.fetch = (async () => {
    call += 1;
    // 第一次是 Yahoo:失敗,退到 Stooq
    if (call === 1) return { ok: false, status: 503 } as unknown as Response;
    return {
      ok: true,
      status: 200,
      text: async () =>
        'Date,Open,High,Low,Close,Volume\n2026-09-28,1,1,1,227.1,1\n2026-09-29,1,1,1,229.5,1\n',
    } as unknown as Response;
  }) as typeof fetch;

  // 紐約 9/29 11:00,盤中
  const row = await fetchUsClose('AAPL', Date.parse('2026-09-29T11:00:00-04:00'));
  assert.equal(row?.price_date, '2026-09-28');
  assert.equal(row?.close_price, 227.1);
});

test('紐約時間換算處理夏令時間', () => {
  assert.deepEqual(newYorkClock(Date.parse('2026-07-01T20:30:00Z')), {
    date: '2026-07-01',
    minutes: 16 * 60 + 30,
  });
  assert.deepEqual(newYorkClock(Date.parse('2026-12-01T20:30:00Z')), {
    date: '2026-12-01',
    minutes: 15 * 60 + 30,
  });
});
