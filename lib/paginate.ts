/**
 * 把查詢分頁撈完。網站與同步腳本共用。
 *
 * PostgREST 單次最多回 1,000 列,超過的部分會被**無聲截掉** —— 不會報錯,
 * 只是資料少一截。趨勢圖選「5 年」就有約 1,826 列,而且查詢是由舊到新排序,
 * 被截掉的剛好是最新的那一段。
 *
 * 用 offset 分頁,所以呼叫端的查詢**一定要排序到唯一**(最後補一個主鍵或唯一欄位),
 * 否則兩頁之間可能重複或漏掉同一個排序值的列。
 *
 * 查詢出錯會丟出來,不當成「沒有資料」—— 畫面上一片空白比錯誤訊息更難除錯。
 */
export async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < pageSize) return all;
  }
}
