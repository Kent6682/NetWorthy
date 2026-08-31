/**
 * 自動完成的排序 —— 決定使用者打完代號第一眼看到什麼。
 * 案例都取自 market_symbols 裡的真實資料。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rankSuggestions,
  sanitizeQuery,
  SUGGESTION_LIMIT,
  type SymbolSuggestion,
} from '../lib/symbol-search.ts';

const s = (symbol: string, name: string): SymbolSuggestion => ({ symbol, name });

test('代號開頭命中的排最前面', () => {
  const ranked = rankSuggestions(
    [s('00632R', '元大台灣50反1'), s('2330', '台積電'), s('6531', '愛普*')],
    '2330'
  );
  assert.equal(ranked[0].symbol, '2330');
  assert.equal(ranked[0].name, '台積電');
});

test('名稱開頭命中,排在名稱中間命中的前面', () => {
  // 打「元大」:元大自己的 ETF 要在「群益那檔名字裡有元大」之前
  const ranked = rankSuggestions(
    [
      s('9999', '某某元大概念股'), // 名稱中間命中 → 最後
      s('0056', '元大高股息'), // 名稱開頭命中
      s('0050', '元大台灣50'), // 名稱開頭命中,代號較小
    ],
    '元大'
  );
  assert.deepEqual(
    ranked.map((r) => r.symbol),
    ['0050', '0056', '9999']
  );
});

test('同一層依代號排序,結果穩定可重現', () => {
  const rows = [s('2454', '聯發科'), s('2412', '中華電'), s('2408', '南亞科')];
  const once = rankSuggestions(rows, '24').map((r) => r.symbol);
  const twice = rankSuggestions([...rows].reverse(), '24').map((r) => r.symbol);

  assert.deepEqual(once, ['2408', '2412', '2454']);
  assert.deepEqual(once, twice, '輸入順序不該影響結果');
});

test('比對不分大小寫 —— 資料庫用的是 ilike,排序也要一致', () => {
  // 打小寫 linepay,LINEPAY 應該算「名稱開頭命中」而不是掉到最後一層
  const ranked = rankSuggestions([s('1234', '某某linepay合作'), s('7402', 'LINEPAY')], 'linepay');
  assert.equal(ranked[0].symbol, '7402');
});

test('最多只回 8 筆', () => {
  const rows = Array.from({ length: 30 }, (_, i) =>
    s(String(2300 + i), `測試${i}`)
  );
  assert.equal(rankSuggestions(rows, '23').length, SUGGESTION_LIMIT);
});

test('沒有結果時回空陣列,不是 undefined', () => {
  assert.deepEqual(rankSuggestions([], '2330'), []);
});

test('清掉會被當成 PostgREST 語法的字元', () => {
  // 逗號會把 or() 的條件切斷、括號與星號有語法意義、% 與 _ 是 ilike 萬用字元
  assert.equal(sanitizeQuery('2330,name.ilike.*'), '2330nameilike');
  assert.equal(sanitizeQuery('  台積電  '), '台積電');
  assert.equal(sanitizeQuery('100%'), '100');
  assert.equal(sanitizeQuery(''), '');
});
