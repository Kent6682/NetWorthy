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
 * 清掉 ilike 的萬用字元,讓使用者打的字一律當成字面比對。
 *
 * `%` 比對任意長度、`_` 比對單一字元 —— 不擋的話,打一個 `%` 會把整份字典撈回來。
 *
 * 只需要處理這兩個字元:查詢是用 ilike() 這個第一級 filter 送出去的,
 * 值由 client 負責編碼。(改用手工組字串的 or() 就得連逗號、括號一起擋,
 * 那也是為什麼不那樣寫 —— 順帶讓 BRK.B 這類代號的小數點得以保留。)
 */
export function sanitizeQuery(raw: string): string {
  return raw.trim().replace(/[%_]/g, '');
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
