# 家庭資產追蹤系統

記錄股票買賣與銀行/券商帳戶餘額,每天自動抓取股價與匯率,在首頁看資產配置與增長趨勢。
支援家人共用,可切換「個人」與「全家」視角。

技術棧:**Next.js 16** + **Supabase**(Postgres + Auth)+ **Vercel**(部署)+ **GitHub Actions**(每日排程)
全部都在各家的免費額度內。

---

## 功能

| 功能 | 說明 |
|---|---|
| 股票買賣紀錄 | 買進、賣出、期初持股三種類型 |
| 均價自動計算 | 移動加權平均法,買賣都會即時重算 |
| 銀行帳戶 | 流水帳制:存入、提出、轉帳、對帳調整 |
| 券商虛擬帳戶 | 買賣股票時自動連動進出,不需手動維護 |
| 總資產 | 股票市值 + 現金,美元自動換算台幣 |
| 資產配置圓餅圖 | 每檔股票與每個帳戶的佔比 |
| 資產增長曲線 | 可切換 1/3/6 個月與 1/3/5 年 |
| 家人共用 | 個人/全家視角切換,各自只能修改自己的資料 |
| 每日自動同步 | 台股、美股收盤價與美元匯率 |
| 響應式介面 | 手機用底部分頁與卡片列表,電腦用頂部導覽與完整表格 |
| 深色模式 | 跟隨系統設定自動切換 |

---

## 部署步驟

整套走完大約 30 分鐘。三個服務都要先註冊(全部免費)。

### 1. 建立 Supabase 專案

1. 到 [supabase.com](https://supabase.com) 註冊並建立新專案
   - Region 選 **Northeast Asia (Tokyo)**,離台灣最近
   - 資料庫密碼請自己記好
2. 專案建好後,進入左側 **SQL Editor** → **New query**
3. 把 `supabase/schema.sql` 的內容整份貼上,按 **Run**
   - 這份 SQL 可以重複執行,之後要改結構再貼一次也沒問題
4. 進入 **Project Settings → API**,記下三個值:

| 名稱 | 用途 |
|---|---|
| Project URL | 網站與同步腳本都會用到 |
| `anon` / `public` key | 網站前端用(可公開,防護靠資料庫的 RLS) |
| `service_role` key | **只給同步腳本用,絕不能放進前端或提交進版控** |

5. 進入 **Authentication → Providers → Email**,確認 Email 登入是開啟的
   - 如果不想每次註冊都要收驗證信,可以把 **Confirm email** 關掉(家用建議關掉)

### 2. 推上 GitHub

```bash
cd asset-tracker
git init
git add .
git commit -m "初始版本"
git branch -M main
git remote add origin https://github.com/<你的帳號>/asset-tracker.git
git push -u origin main
```

Repo 建議設為 **Private**。`.gitignore` 已經排除 `.env.local`,金鑰不會被提交。

### 3. 部署到 Vercel

1. 到 [vercel.com](https://vercel.com) 用 GitHub 帳號登入
2. **Add New → Project** → 選剛剛推上去的 repo
3. Framework 會自動偵測成 Next.js,不用改設定
4. 展開 **Environment Variables**,加入兩個:

```
NEXT_PUBLIC_SUPABASE_URL       = https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY  = eyJhbGciOi...
```

5. 按 **Deploy**,等一兩分鐘就會拿到網址

> Vercel 的 Hobby 方案免費,但條款限定**非商業、個人用途** — 家用記帳完全符合。

### 4. 設定每日自動同步

1. 到 GitHub repo → **Settings → Secrets and variables → Actions**
2. 按 **New repository secret**,加入兩個:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 你的 Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 你的 `service_role` key |

3. 到 repo 的 **Actions** 分頁,如果看到提示就按 **I understand my workflows, enable them**
4. 選左側「每日同步股價與資產快照」→ 右邊 **Run workflow** 手動跑一次,確認會成功

排程設定在 `.github/workflows/sync-prices.yml`:
- 台灣時間 **14:30**(台股收盤後)
- 台灣時間隔天 **06:30**(美股收盤後,補抓美股與匯率)

> GitHub 的排程在尖峰時段可能延遲十幾分鐘,這對每日收盤價沒有影響。
> 另外,repo 若連續 60 天沒有任何 commit,GitHub 會自動停用排程並寄信通知,屆時到 Actions 分頁重新啟用即可。

### 5. 開始使用

1. 打開 Vercel 給你的網址,註冊第一個帳號
2. 建立家庭(取個名字就好)
3. 到 **設定** 頁複製邀請碼給家人,他們註冊後選「加入既有家庭」貼上
4. 到 **帳戶** 頁,把每個銀行帳戶與券商虛擬帳戶建起來,各輸入一次目前餘額
5. 到 **股票** 頁,用「期初持股」把手上每一檔股票的**股數與均價**輸入進去
6. 之後只要記錄新發生的買賣與現金進出就好

---

## 日常使用邏輯

### 銀行/券商餘額是算出來的,不是填出來的

建立帳戶時輸入一次期初餘額,之後餘額由流水帳累加得出,沒有可以直接編輯的總額欄位。

| 類型 | 什麼時候用 |
|---|---|
| 期初餘額 | 建立帳戶時,只有一次 |
| 存入 / 提出 | 日常進出帳 |
| 轉出 / 轉入 | 帳戶之間搬錢,成對記錄,總資產不變 |
| 對帳調整 | 帳面跟實際對不起來時 |

**對帳調整**是刻意設計的:銀行給的利息、忘記記的一筆提款、跨行手續費,一定會遇到。
正確做法不是回頭改舊紀錄(那就失去流水帳的意義),而是補一筆調整並寫明原因 —
帳上永遠看得到曾經差過多少、為什麼。調整金額可以填負數。

### 券商帳戶不用手動維護

記錄股票買賣時,系統會自動在對應的券商帳戶產生一筆收支:

- **買進** → `提出`,金額 = 股數 × 價格 + 手續費
- **賣出** → `存入`,金額 = 股數 × 價格 − 手續費與稅
- **期初持股** → 不連動(它代表既有部位,不是新的資金進出)

表單上的勾選項預設打開,某筆不想連動可以取消。
刪除一筆買賣時,連動產生的帳戶紀錄也會一併移除。

### 均價怎麼算

採**移動加權平均法**:

```
期初  直接採用輸入的均價作為起點
買進  新均價 = (原持股 × 原均價 + 買進股數 × 買進價 + 手續費) ÷ 總股數
賣出  均價不變,持股數減少,總成本按均價等比減少,差額計入已實現損益
```

賣光後再買進,均價會以新的買進價重新起算,已實現損益則保留累計。
這段邏輯在 `lib/holdings.ts`,有 14 個單元測試涵蓋各種情境(`npm test`)。

---

## 介面設計

視覺方向參照 **Mercury / Kubera** 一類的財務工具:克制的排版、充足留白、細線分隔。
顏色只用來表達兩件事 —— **損益狀態**與**圖表識別**,不做裝飾。數字本身是主角。

### 響應式

同一份程式碼在手機與電腦上呈現不同的版面,不是把桌機畫面縮小。

| | 手機(< 768px) | 電腦(≥ 768px) |
|---|---|---|
| 導覽 | 底部固定四分頁,拇指觸及範圍 | 頂部橫向分頁 |
| 資料列表 | 每筆一張卡片,重要數字放大 | 完整多欄表格 |
| 新增表單 | 從底部滑上的面板,送出鍵固定在底 | 置中對話框 |
| 統計方塊 | 2 × 2 | 4 欄並排(≥ 1024px) |
| 圓餅圖 | 圖在上、清單在下 | 左右並排 |
| 卡片 | 貼齊螢幕兩側,只留上下框線 | 圓角卡片配細框 |

其他行動裝置的細節:

- 輸入框字級 16px,避免 iOS 聚焦時自動放大整個畫面
- 按鈕與輸入框最小高度 44px,符合觸控目標尺寸
- 底部分頁列吃 `env(safe-area-inset-bottom)`,躲開 iPhone 的 Home Indicator
- 趨勢圖支援 `touchmove` 取值,不是只有滑鼠 hover
- 期間選擇列在窄螢幕可橫向滑動,不擠壓版面
- 尊重 `prefers-reduced-motion`

### 深色模式

跟隨系統設定自動切換。深色不是把淺色反轉,而是各自挑過的一組色階 ——
圖表的 8 色分類色盤在兩種模式下都獨立通過色盲安全性驗證
(相鄰色差 CVD ΔE:淺色 9.1、深色 8.4,皆高於 8 的門檻)。

### 驗證方式

用實際瀏覽器在 **390px(iPhone)/ 768px(iPad)/ 1440px(桌機)** 三種寬度,
淺色與深色各跑一次,自動檢查每個元素是否超出視窗寬度。
五個頁面 × 三種寬度 × 兩種模式 = 30 種組合,全部無橫向溢出。

## 資料來源

| 資料 | 來源 | 需要金鑰 |
|---|---|---|
| 台股(上市) | 證交所 OpenAPI `STOCK_DAY_ALL` | 否 |
| 台股(上櫃) | 櫃買中心 OpenAPI | 否 |
| 美股 | Yahoo Finance,失敗自動退到 Stooq | 否 |
| 美元匯率 | open.er-api.com,失敗自動退到 Frankfurter | 否 |

台股一次呼叫就拿回全市場報價,美股則逐檔抓。任一來源失敗只會影響該檔股票,
不會讓整份同步中斷 — 缺報價的標的會暫時以成本價估算市值,並在畫面上標示「未同步」。

**匯率抓不到時會中止當次同步**,而不是用 1:1 硬算 —— 寧可少一天資料,
也不要在趨勢圖裡留下一個假的斷崖。

---

## 本機開發

```bash
npm install
cp .env.example .env.local   # 填入你的 Supabase URL 與 anon key
npm run dev                  # http://localhost:3000
```

其他指令:

```bash
npm test          # 跑單元測試(均價計算 + 資料來源解析,共 23 個)
npm run build     # 產生正式版建置
npm run sync      # 手動跑一次每日同步(需要 SUPABASE_SERVICE_ROLE_KEY)
```

驗證資料庫 schema(需要本機有 PostgreSQL):
`supabase/test_schema.sql` 涵蓋觸發器連動、餘額計算、約束條件與 RLS 權限隔離。

---

## 專案結構

```
app/
  (app)/              登入後的頁面
    page.tsx            首頁:總資產、圓餅圖、增長曲線
    stocks/             股票:持股列表、交易紀錄、新增交易
    accounts/           帳戶:餘額列表
    accounts/[id]/      單一帳戶的收支流水帳
    settings/           家庭邀請碼、同步狀態
  actions/            Server Actions(所有寫入操作)
  login/ onboarding/  註冊登入、建立或加入家庭
components/           圖表與表單元件
lib/
  holdings.ts         均價計算核心(網站與同步腳本共用)
  portfolio.ts        市值換算、資產切片、統計
  queries.ts          資料查詢
  supabase/           Supabase client(server / browser / session)
scripts/
  sync-prices.ts      每日同步主程式
  providers.ts        各市場資料來源
supabase/
  schema.sql          完整建表 SQL(含 RLS)
  test_schema.sql     schema 功能測試
tests/                單元測試
```

---

## 安全性

- 所有資料表都開啟 **Row Level Security**:讀取限同一家庭,寫入限本人
- `service_role` 金鑰只存在 GitHub Secrets,只有同步腳本會用到
- `anon` 金鑰出現在瀏覽器是正常的,真正的防護在資料庫層
- `.env.local` 已在 `.gitignore` 中

---

## 之後可以加的功能

- 股利記錄與殖利率統計
- 資產目標與達成率
- 匯出 Excel
- 房地產、保單等其他資產類別(在 `accounts` 加一種 type 即可)
