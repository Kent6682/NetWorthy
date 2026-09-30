# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

程式碼註解、UI 文案、commit 訊息一律使用繁體中文,請沿用。

## 指令

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm test         # node --test,146 個測試,不連網(但要先 npm install)
npm run sync     # 手動跑一次每日同步(需 SUPABASE_SERVICE_ROLE_KEY)
npm run backfill # 從第一筆交易重算所有歷史快照並補抓歷史價格(同上,需金鑰)
```

跑單一測試檔或單一測試:

```bash
node --test --experimental-strip-types tests/holdings.test.ts
node --test --experimental-strip-types --test-name-pattern="零股" tests/holdings.test.ts
```

專案沒有 eslint。型別檢查用 `npm run build`(`tsc --noEmit` 也可以)。

資料庫沒有 migration 工具:`supabase/schema.sql` 是完整且可重複執行的單一份 SQL,改完整份貼進 Supabase SQL Editor 執行(或用 Supabase MCP 的 `apply_migration` 送同一份內容)。`supabase/test_schema.sql` 驗證觸發器、餘額計算、約束與 RLS,需要本機 PostgreSQL。

**這個 repo 不能放在 Google Drive 同步的資料夾裡跑** —— npm 解壓大量小檔會跟 Drive 打架,`npm ci` 穩定噴 `EBADF: bad file descriptor`。本機路徑是 `D:\MyData\projects\NetWorthy`。

## 兩種執行環境共用同一份 lib

`lib/holdings.ts` 同時被 Next.js 網站與 `scripts/sync-prices.ts` 使用,而後者是用 `node --experimental-strip-types` 直接跑 TypeScript,沒有打包器。因此有兩套 import 慣例,不要混用:

| 位置 | 寫法 |
|---|---|
| `lib/`、`scripts/`、`tests/` | 相對路徑**且帶 `.ts` 副檔名**:`import { … } from './holdings.ts'` |
| `app/`、`components/` | 路徑別名、不帶副檔名:`import { … } from '@/lib/portfolio'` |

`tsconfig.json` 的 `allowImportingTsExtensions` 就是為了前者。在 `lib/` 裡改成別名或省略 `.ts`,網站還會動,但 `npm run sync` 與 `npm test` 會直接掛掉。

## 金額怎麼算出來的

三層各有唯一真實來源,不要在別處重算或加快取欄位:

1. **帳戶餘額 = 資料庫算的。** `accounts` 沒有餘額欄位。`account_transactions.signed_amount` 是 generated column(依 `type` 決定正負),`account_balances` view 把它加總。要改餘額只能新增一筆流水,不能改總額。
2. **券商現金 = 觸發器算的。** `sync_broker_cash()` 掛在 `stock_transactions` 的 insert/update/delete 上,買進產生 `withdraw`、賣出產生 `deposit`,`initial`(期初持股)不連動。這些列帶有 `stock_transaction_id`,**永遠不要手動新增或修改** —— 觸發器每次都會先把舊的刪掉重建。
3. **持股均價 = `lib/holdings.ts` 算的。** 移動加權平均法,網站與同步腳本共用這一份。排序規則(交易日 → 同日 initial 優先 → created_at → id)關係到結果可重現,改動前先看 `tests/holdings.test.ts` 的 14 個案例。
   已實現損益的合計要用 `computeRealizedTwd()`,**不能**從 `buildValuedHoldings()` 加總 —— 那份清單濾掉了股數 0 的標的,而全部賣光的那一檔正是已實現損益的來源。

4. **每日盈虧 = `lib/pnl.ts` 算的。** 公式是「股票市值變化 − 當日買進金額 + 當日賣出金額 − 手續費與稅」。**基準刻意是股票市值而不是總資產** —— 用總資產的話,沒勾選「同步更新券商帳戶餘額」的買賣會憑空生出資產(股票增加、現金卻沒減少)。導入既有持股(`initial`)那天不計盈虧,那天既沒賺也沒賠。現金完全不參與。

5. **年度損益 = `lib/yearly.ts` 算的。** 每年結算「期末股票市值 − 期初 − 買入(含期初持股)+ 賣出實收」,扣掉當年已實現就是當年未實現 —— 未實現是**當年變動**,不是年底帳面,所以各年能直接相加。首頁「今年未實現 / 今年已實現」兩格讀的是這裡,不是 `computeTotals()`。

`stocks` 與 `market_symbols` 是兩回事,不要混用:`stocks` 只放這個家庭真的交易過的標的(被 `stock_transactions` 以外鍵參照),`market_symbols` 是每日同步整批 upsert 進來的**全市場代號字典**,只服務「新增交易時打代號自動帶出商品名稱」這件事,而且只新增不刪除。

`market_holidays` 同樣是每日同步寫進來的公用資料:證交所當年度行事曆裡**沒有交易**的日子(「開始交易日」「最後交易日」有開盤,要濾掉)。日曆靠它標節日名稱,`computeDailyPnl()` 也優先信它,不再只靠「那天沒收盤價」去猜休市。

新增交易表單的台股手續費由 `lib/fees.ts` 估算帶入(牌告 0.1425%、證交稅依代號判斷),使用者改過就不再覆蓋。這只是表單預設值 —— 存進資料庫的是欄位最後的數字,之後所有計算都只認那個數字。股數與手續費輸入框帶千分位,server action 用 `parseNumberInput()` 去掉逗號。

`daily_net_worth_snapshots` 是同步腳本每天整批重算的衍生資料:先刪掉那些日期的列再重寫,所以重跑不會重複。每位成員一列,另外每個家庭多一列 ``owner_id` IS NULL` 的合計 —— 首頁「全家」視角讀的就是那一列。

**台股收盤價的可信度順序:交易所指定日期的正式行情 → openapi 全市場檔案 → Yahoo。** 每次同步都向證交所 `MI_INDEX` 與櫃買 `dailyQuotes` 重抓近幾個交易日(`officialPriceDates()`,今天往回 6 天、略過週末)的正式收盤價,之前用後備來源暫時補上的價格會被蓋掉 —— **當日與前日的收盤價因此一定是正式的**。openapi 的 `STOCK_DAY_ALL` 要到**隔天早上**才更新,不能當主要來源。Yahoo 只在交易所都還沒有今天時才問,而且 `fetchYahooLatest()` 會略過**還在交易中**的那一根(用回應裡的 `currentTradingPeriod`,收盤後再等 15 分鐘)—— 早上那班常延到 9 點開盤後才跑,不擋的話會把盤中價當收盤價寫進去。Stooq 同理用紐約時間判斷。

**寫入前還有一道只看時鐘的關卡:`isCloseSettled()`。** 台股當天的價格要台北時間 14:00 以後、美股要紐約時間 16:15 以後才寫入,不管來自哪個來源。來源自己的判斷(Yahoo 的交易時段欄位)萬一缺欄位或出錯,這一關仍然擋得住盤中價。刻意**不是**「盤中整班不跑」—— 早上那班還要寫昨天的正式收盤價、美股收盤價與匯率,擋掉的只有「今天」的台股價格。

**快照重算的起點取三者最早:昨天、待重算清單、這次寫入的最早價格日期。** 多算昨天是因為昨天那班可能跑在正式收盤價公布前;價格日期那一項是因為近幾天的價格可能剛被正式價格更正(例如排程被 GitHub 跳過一兩班)。也因為要重算過去的日子,`rebuildSnapshots()` 不能用 `latest_stock_prices`(每檔只有最新一天),必須依日期查價。

**有開盤、但持有中的台股有任何一檔缺當天收盤價的日子,日曆一律「待更新」**(`incompleteDays()`)。那種快照是部分沿用舊價格算的,數字看起來正常卻是錯的 —— 2026-09-29 就曾只算了一檔。單日明細則靠 `priceDate` 把沿用舊價格的那一列標成「未更新」。美股不參與這個檢查(開盤日跟台股不同)。

**交易變動時從最早受影響的那天重算。** `stock_transactions` 與 `account_transactions` 上的 `request_snapshot_rebuild()` 觸發器,在任何新增、修改、刪除時把「新舊日期中較早的那天」記進 `snapshot_rebuild_requests`(每個家庭一列,只保留最早的日期)。下一次每日同步看到就從那天重算,算完只清掉開跑前提出的請求。所以補登、編輯、刪除舊交易都不用再手動回填。重算區間可能長達數月,查價一律用 `selectAll()` 分頁 —— PostgREST 單次 1,000 列的上限會**無聲截斷**。

仍然需要 `npm run backfill`(或 GitHub Actions 的「回填歷史資產快照」)的情況:新增一檔**以前沒有的股票**、而交易日期在過去。每日同步只抓最新收盤價,那段期間的歷史價格要靠回填去證交所補抓,否則那段快照會退回成本價估算。

快照的計算本身在 `lib/snapshots.ts` 的 `computeSnapshotRows()`,**每日同步與回填共用這一份**。它自己依日期過濾交易,所以回填撈一次資料就能算出好幾個月的每一天。要改算法只能改那裡。

## 幣別與缺資料的處理

換算成台幣只在兩個地方發生:網站是 `lib/portfolio.ts` 的 `toTwd()`,腳本是 `rebuildSnapshots()` 內。其餘所有計算都留在原幣別。

兩條刻意的降級規則,改動前請先理解:

- **缺報價** → 退回成本價估市值(`?? h.avgCost`),總資產不會因為少一天報價就憑空掉一塊,畫面標示「未同步」。
- **缺匯率** → 先用資料庫裡最近一次的匯率;連歷史匯率都沒有就**讓整次同步失敗**,不用 1:1 硬算。寧可少一天資料,也不要在趨勢圖留下假的斷崖。

## 權限模型

RLS 是唯一的安全邊界,不是輔助措施。讀取範圍是同一家庭(`household_member_ids()`),寫入範圍是本人(``owner_id` = auth.uid()`)。

- 網站用 anon key + 使用者 cookie,受 RLS 保護 —— `lib/supabase/server.ts`(Server Component / Server Action)、`client.ts`(Client Component)。
- 同步腳本用 service_role key **繞過 RLS**,因為它必須替所有家庭成員算快照。這把金鑰只存在 GitHub Secrets。
- 新增資料表時,`schema.sql` 裡要同時補上 `enable row level security` 與對應 policy;新增 `security definer` 函式時,記得在第 8 節那樣收回 PUBLIC/anon 的 EXECUTE 權限(Supabase 的安全檢查會抓)。

`proxy.ts` 是 Next.js 16 版的 middleware(已改名),轉呼叫 `lib/supabase/session.ts` 的 `updateSession()`:每個請求刷新一次 Supabase session,未登入者導向 `/login`。`app/(app)/layout.tsx` 再擋一層 —— 沒有 household 的使用者導向 `/onboarding`。

## 寫入一律走 Server Action

`app/actions/` 是所有寫入操作的唯一入口。慣例:

```ts
export async function xxx(_prev: unknown, formData: FormData): Promise<{ error?: string; ok?: boolean }>
```

`_prev` 的簽名是為了配合 client 端的 `useActionState`。所有驗證在 action 內做完並回傳中文錯誤字串;成功後對受影響的路徑呼叫 `revalidatePath()` —— 因為金額是跨頁連動的,動到股票通常要一併 revalidate `/stocks`、`/accounts` 與 `/`。

所有頁面都是 `export const dynamic = 'force-dynamic'` 的 async Server Component,從 `lib/queries.ts` 取資料。視角切換靠 URL search param:`parseScope(params.scope)` → `ownerIdsForScope()` 決定要納入哪些 `owner_id`。

編輯股票交易走 `updateStockTransaction()`,與新增共用 `parseStockForm()`。連動全部在資料庫層:券商帳戶由 `sync_broker_cash()` 刪舊建新、快照由 `request_snapshot_rebuild()` 排入重算,應用程式只改那一列。刪除一律用 `components/ConfirmDelete.tsx` 的兩段式確認,不要用 `window.confirm()`。

`/auth/*` 在 `session.ts` 的公開路徑內:`/auth/forgot-password` 寄信、`/auth/callback` 把信裡的 `code`(PKCE)或 `token_hash`(跨瀏覽器可用)換成登入狀態、`/auth/reset-password` 設新密碼。`callback` 的 `next` 只接受站內路徑。

**刻意不放 `loading.tsx`。** 曾經每個路由都加過,但那會在伺服器回應前把畫面清空,使用者看到的是一個沒有資訊的空殼 —— 比「畫面還沒動」更難接受。現在改成保留舊內容不動,由 `Nav` 裡的 `PendingDot`(`useLinkStatus`)在被點的分頁上標一個點。要加回骨架前請先確認這個取捨。

頁面內的多筆查詢一律用 `Promise.all` 併發,不要寫成一連串 `await`。

**PostgREST 單次最多回 1,000 列,超過的部分無聲截斷。** 任何會隨時間變長的查詢(快照、交易、流水帳、價格)都要用 `lib/paginate.ts` 的 `selectAll()` 分頁撈完 —— 網站與腳本共用這一份(腳本經由 `scripts/db.ts` 轉出)。offset 分頁要求**排序唯一**,查詢最後一定要補主鍵(`.order('id')`,價格表補 `symbol`),否則兩頁之間會重複或漏列。趨勢圖「5 年」約 1,826 列,沒分頁的話被截掉的是最新那段。日曆一次撈整年(月曆與 12 個月列同一份資料,月合計才保證等於格子加總);年度表用 `getMarketDataNear()` 只撈每個年底前 30 天。換頁慢的根本解法是減少往返與縮短距離(見 `vercel.json` 把函式釘在東京,與 Supabase 同區),不是拿骨架去蓋。

`getSession()` 用 React `cache()` 包著:layout 與頁面在同一個請求裡各呼叫一次,沒有這層會讓 `auth.getUser()` 與成員查詢整組跑兩次。新增類似的「每個請求都要用到」的查詢時照這個模式。

## 介面慣例

- 沒有 UI 套件、沒有圖表套件。`DonutChart` 與 `TrendChart` 是手寫 SVG(含 `touchmove` 取值)。
- Tailwind 只負責版面;元件樣式是 `app/globals.css` 裡手寫的一層:`.card`、`.field`、`.btn-*`、`.sheet-*`、`.tabbar-*`、`.container-app`、`.tnum`(等寬數字)、`.pos`/`.neg`(損益色)、`.eyebrow`。加新元件前先看這裡有沒有現成的。
- **漲跌色與狀態色是兩組,不要混用。** `--gain`(紅)/ `--loss`(綠)是財務漲跌,照台股慣例;`--positive`(綠)/ `--negative`(紅)是 UI 的成功與錯誤。對應的 class:`.pos` / `.neg` 只給金額,錯誤訊息用 `.error-text`。
  混用會出事:早期 `.neg` 同時被拿去標虧損與錯誤訊息,改成台股慣例時全站的錯誤訊息會一起變綠。
- **顏色一律用 CSS 變數**,不要寫死色碼,也不要用 Tailwind 的預設色階。深色模式在 `globals.css` 定義了兩次(`@media (prefers-color-scheme: dark)` 與 `:root[data-theme='dark']`),改色票要兩邊都改。`--series-1` 到 `--series-8` 是圖表分類色盤,依固定順序取用、不循環,兩種模式都通過色盲安全性驗證,不要隨意換色。
- 手機與桌機是兩套版面而非縮放,斷點 768px:手機底部分頁 + 卡片列表 + 底部滑出面板;桌機頂部導覽 + 完整表格 + 置中對話框。輸入框字級固定 16px(避免 iOS 聚焦時放大畫面),觸控目標最小 44px。

## 每日同步

`.github/workflows/sync-prices.yml` 每個工作日跑兩次(台灣時間 14:47 台股收盤後、隔天 06:17 美股收盤後),也可手動觸發。**分鐘刻意避開 :00 與 :30** —— GitHub 排程在整點、半點最擁擠,實測 14:30 那班常拖到晚上 8~9 點。延遲只影響「多快看到」,不影響正確性。資料來源都是免費、免金鑰的公開介面,各有備援(`scripts/providers.ts`):台股見上面的可信度順序,美股逐檔抓(Yahoo → Stooq),匯率 open.er-api.com → Frankfurter。單一標的抓不到只會 warn,不中斷整份同步。

公開 repo 連續 60 天沒有活動,GitHub 會自動停用排程。`.github/workflows/keepalive.yml` 每月 1 日對排程工作流程呼叫一次「啟用」API 重設計時(連自己一起),不產生 commit。
