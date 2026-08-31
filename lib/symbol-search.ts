/**
 * 股票代號自動完成的字串處理與排序 —— 純函式,不碰資料庫。
 *
 * 抽出來的理由跟 holdings.ts 一樣:排序規則決定使用者第一眼看到什麼,
 * 是這個功能的實質內容,值得用測試釘住,不該埋在 route handler 裡。
 */

export interface SymbolSuggestion {
  symbol: string;
  name: string;
}

/** 下拉選單回幾筆 —— 再多就要捲動,反而不好選 */
export const SUGGESTION_LIMIT = 8;

/**
 * 把使用者打的字清成可以安全組進 PostgREST 查詢字串的樣子。
 *
 * or() 是把條件直接串成字串送出去的,逗號、括號、點在裡面有語法意義;
 * % 與 _ 則是 ilike 的萬用字元。全部拿掉,不讓使用者打的字被當成語法解析。
 */
export function sanitizeQuery(raw: string): string {
  return raw.trim().replace(/[,()*%_.\\]/g, '');
}

/**
 * 排序規則,由前到後:
 *   0  代號開頭命中 —— 打 2330 第一眼就要看到台積電
 *   1  名稱開頭命中 —— 打「元大」先給元大自己的 ETF
 *   2  其餘(名稱中間命中)
 *
 * 同一層再依代號排,同樣的輸入永遠得到同樣的順序。
 * 比對一律轉大寫:資料庫那邊用的是 ilike(不分大小寫),
 * 這裡若用區分大小寫的比對,打小寫 linepay 會讓 LINEPAY 掉到最後一層。
 */
export function rankSuggestions(
  rows: SymbolSuggestion[],
  query: string,
  limit: number = SUGGESTION_LIMIT
): SymbolSuggestion[] {
  const needle = query.toUpperCase();

  return rows
    .map((row) => ({
      row,
      rank: row.symbol.toUpperCase().startsWith(needle)
        ? 0
        : row.name.toUpperCase().startsWith(needle)
          ? 1
          : 2,
    }))
    .sort((a, b) => a.rank - b.rank || a.row.symbol.localeCompare(b.row.symbol))
    .slice(0, limit)
    .map(({ row }) => row);
}
