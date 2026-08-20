# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

程式碼註解、UI 文案、commit 訊息一律使用繁體中文,請沿用。

## 指令

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm test         # node --test,23 個測試,不需 node_modules、不連網
npm run sync     # 手動跑一次每日同步(需 SUPABASE_SERVICE_ROLE_KEY)
```

跑單一測試檔或單一測試:

```bash
node --test --experimental-strip-types tests/holdings.test.ts
node --test --experimental-strip-types --test-name-pattern="零股" tests/holdings.test.ts
```

`npm run lint` 在 package.json 裡,但專案沒有 eslint 設定檔也沒裝 eslint,實際上跑不起來 —— 型別檢查請用 `npm run build`(`tsc --noEmit` 也可以)。

資料庫沒有 migration 工具:`supabase/schema.sql` 是完整且可重複執行的單一份 SQL,改完整份貼進 Supabase SQL Editor 執行。`supabase/test_schema.sql` 驗證觸發器、餘額計算、約束與 RLS,需要本機 PostgreSQL。

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

`stocks` 與 `market_symbols` 是兩回事,不要混用:`stocks` 只放這個家庭真的交易過的標的(被 `stock_transactions` 以外鍵參照),`market_symbols` 是每日同步整批 upsert 進來的**全市場代號字典**,只服務「新增交易時打代號自動帶出商品名稱」這件事,而且只新增不刪除。

`daily_net_worth_snapshots` 是同步腳本每天整批重算的衍生資料:先刪掉當天所有列再重寫,所以同一天重跑不會重複。每位成員一列,另外每個家庭多一列 ``owner_id` IS NULL` 的合計 —— 首頁「全家」視角讀的就是那一列。

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

因為全部是 `force-dynamic`,**每個路由都必須有 `loading.tsx`** —— 沒有的話,點下分頁到伺服器回應前畫面完全不動,看起來像當掉。骨架的積木在 `components/Skeleton.tsx`。頁面內的多筆查詢一律用 `Promise.all` 併發,不要寫成一連串 `await`。

`getSession()` 用 React `cache()` 包著:layout 與頁面在同一個請求裡各呼叫一次,沒有這層會讓 `auth.getUser()` 與成員查詢整組跑兩次。新增類似的「每個請求都要用到」的查詢時照這個模式。

## 介面慣例

- 沒有 UI 套件、沒有圖表套件。`DonutChart` 與 `TrendChart` 是手寫 SVG(含 `touchmove` 取值)。
- Tailwind 只負責版面;元件樣式是 `app/globals.css` 裡手寫的一層:`.card`、`.field`、`.btn-*`、`.sheet-*`、`.tabbar-*`、`.container-app`、`.tnum`(等寬數字)、`.pos`/`.neg`(損益色)、`.eyebrow`。加新元件前先看這裡有沒有現成的。
- **顏色一律用 CSS 變數**,不要寫死色碼,也不要用 Tailwind 的預設色階。深色模式在 `globals.css` 定義了兩次(`@media (prefers-color-scheme: dark)` 與 `:root[data-theme='dark']`),改色票要兩邊都改。`--series-1` 到 `--series-8` 是圖表分類色盤,依固定順序取用、不循環,兩種模式都通過色盲安全性驗證,不要隨意換色。
- 手機與桌機是兩套版面而非縮放,斷點 768px:手機底部分頁 + 卡片列表 + 底部滑出面板;桌機頂部導覽 + 完整表格 + 置中對話框。輸入框字級固定 16px(避免 iOS 聚焦時放大畫面),觸控目標最小 44px。

## 每日同步

`.github/workflows/sync-prices.yml` 每個工作日跑兩次(台灣時間 14:30 台股收盤後、隔天 06:30 美股收盤後),也可手動觸發。資料來源都是免費、免金鑰的公開介面,各有備援(`scripts/providers.ts`):台股走證交所 + 櫃買中心各一次呼叫涵蓋全市場,美股逐檔抓(Yahoo → Stooq),匯率 open.er-api.com → Frankfurter。單一標的抓不到只會 warn,不中斷整份同步。

repo 連續 60 天沒有 commit,GitHub 會自動停用排程。
