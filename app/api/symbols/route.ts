import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * 股票代號自動完成 — 查 market_symbols 這張每日同步的全市場字典。
 *
 * 這裡不另外檢查身分:用的是帶使用者 cookie 的 client,
 * market_symbols 的 RLS 政策只開放給 authenticated,未登入的請求自然拿到空結果。
 */

export const dynamic = 'force-dynamic';

/** 回幾筆給下拉選單 —— 再多就要捲動,反而不好選 */
const LIMIT = 8;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const market = params.get('market') === 'US' ? 'US' : 'TW';

  /*
   * PostgREST 的 or() 是把條件直接組進查詢字串,逗號、括號、點在裡面有語法意義,
   * % 與 _ 則是 ilike 的萬用字元。全部拿掉,不讓使用者打的字被當成語法解析。
   */
  const q = (params.get('q') ?? '').trim().replace(/[,()*%_\.]/g, '');
  if (!q) return NextResponse.json([]);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('market_symbols')
    .select('symbol, name')
    .eq('market', market)
    // or() 裡的萬用字元要用 *(PostgREST 自己會換成 %),
    // 直接寫 % 會跟百分號編碼混在一起
    .or(`symbol.ilike.${q}*,name.ilike.*${q}*`)
    .limit(40);

  // 自動完成掛掉不該讓表單也跟著壞,回空陣列讓使用者照樣手動輸入
  if (error) return NextResponse.json([]);

  const needle = q.toUpperCase();
  const ranked = (data ?? [])
    .map((row) => ({
      symbol: row.symbol as string,
      name: row.name as string,
      // 代號開頭命中的排最前面 —— 打 2330 要第一眼就看到台積電
      rank: (row.symbol as string).toUpperCase().startsWith(needle)
        ? 0
        : (row.name as string).startsWith(q)
          ? 1
          : 2,
    }))
    .sort((a, b) => a.rank - b.rank || a.symbol.localeCompare(b.symbol))
    .slice(0, LIMIT)
    .map(({ symbol, name }) => ({ symbol, name }));

  return NextResponse.json(ranked, {
    // 字典一天才變一次,退格重打時不用再問一次伺服器
    headers: { 'Cache-Control': 'private, max-age=300' },
  });
}
