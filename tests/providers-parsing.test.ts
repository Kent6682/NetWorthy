/**
 * 用各來源的真實回應格式做 fixture,驗證解析邏輯。
 * 這裡不連外網,把 global fetch 換成假的。
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchTwseCloses, fetchTpexCloses, fetchUsdTwd } from '../scripts/providers.ts';

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
