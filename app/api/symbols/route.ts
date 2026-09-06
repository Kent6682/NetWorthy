import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rankSuggestions, sanitizeQuery, type SymbolSuggestion } from '@/lib/symbol-search';

/**
 * 股票代號自動完成 — 查 market_symbols 這張每日同步的全市場字典。
 *
 * 這裡不另外檢查身分:用的是帶使用者 cookie 的 client,
 * market_symbols 的 RLS 政策只開放給 authenticated,未登入的請求自然拿到空結果。
 */

export const dynamic = 'force-dynamic';

/** 先撈寬一點再排序取前幾筆,才不會因為資料庫回傳順序而漏掉更該排前面的 */
const FETCH_LIMIT = 40;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const market = params.get('market') === 'US' ? 'US' : 'TW';

  const q = sanitizeQuery(params.get('q') ?? '');
  if (!q) return NextResponse.json([]);

  const supabase = await createClient();
  const table = () => supabase.from('market_symbols').select('symbol, name').eq('market', market);

  /*
   * 兩個獨立查詢併發,而不是一句 or()。
   *
   * or() 是把條件手工組成字串送出去的,值裡的逗號、括號與萬用字元都得自己
   * escape,錯了不會報錯、只會安靜地查不到東西。ilike() 是第一級的 filter,
   * 值由 client 負責編碼,不必猜 PostgREST 的語法。
   */
  const [byCode, byName] = await Promise.all([
    table().ilike('symbol', `${q}%`).limit(FETCH_LIMIT),
    table().ilike('name', `%${q}%`).limit(FETCH_LIMIT),
  ]);

  // 自動完成掛掉不該讓表單也跟著壞,回空陣列讓使用者照樣手動輸入
  if (byCode.error && byName.error) return NextResponse.json([]);

  // 兩邊都命中的只留一筆
  const merged = new Map<string, SymbolSuggestion>();
  for (const row of [...(byCode.data ?? []), ...(byName.data ?? [])]) {
    const s = row as SymbolSuggestion;
    if (!merged.has(s.symbol)) merged.set(s.symbol, s);
  }

  const ranked = rankSuggestions([...merged.values()], q);

  return NextResponse.json(ranked, {
    // 字典一天才變一次,退格重打時不用再問一次伺服器
    headers: { 'Cache-Control': 'private, max-age=300' },
  });
}
