-- ============================================================================
-- 家庭資產追蹤系統 — Supabase Schema
-- ----------------------------------------------------------------------------
-- 使用方式:在 Supabase 後台 → SQL Editor → 貼上整份執行一次。
-- 可重複執行(所有物件都有 if not exists / or replace / drop policy if exists)。
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. 家庭與成員
-- ============================================================================

create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  household_id  uuid references public.households(id) on delete set null,
  display_name  text not null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_profiles_household on public.profiles(household_id);

-- 使用者註冊時自動建立 profile
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 取得目前登入者所屬的家庭 id(RLS 政策共用)
create or replace function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select household_id from public.profiles where id = auth.uid()
$$;

-- 目前登入者的家庭成員 id 清單(含自己)
create or replace function public.household_member_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where p.id = auth.uid()
     or (p.household_id is not null and p.household_id = public.current_household_id())
$$;

-- ============================================================================
-- 2. 資金帳戶(銀行 + 券商虛擬帳戶)
-- ============================================================================

create table if not exists public.accounts (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  type         text not null check (type in ('bank', 'broker_cash')),
  institution  text not null,                 -- 機構名稱,例如「國泰世華」「元大證券」
  nickname     text,                          -- 自訂備註,例如「薪轉戶」
  currency     text not null default 'TWD' check (currency in ('TWD', 'USD')),
  is_archived  boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists idx_accounts_owner on public.accounts(owner_id);

-- ----------------------------------------------------------------------------
-- 帳戶收支流水帳 — 餘額不直接編輯,由這張表累加算出
-- ----------------------------------------------------------------------------
create table if not exists public.account_transactions (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.accounts(id) on delete cascade,
  type                   text not null check (type in
                           ('initial', 'deposit', 'withdraw', 'transfer_in', 'transfer_out', 'adjustment')),
  amount                 numeric(18,2) not null,
  transaction_date       date not null,
  counterpart_account_id uuid references public.accounts(id) on delete set null,
  note                   text,
  -- 由股票交易自動連動產生時,記錄來源;手動新增則為 null
  stock_transaction_id   uuid,
  created_at             timestamptz not null default now(),

  -- adjustment 允許負數(對帳往下修);其餘型別一律填正數,方向由 type 決定
  constraint amount_sign_ck check (amount >= 0 or type = 'adjustment'),

  -- 帶正負號的金額,餘額 = sum(signed_amount)
  signed_amount numeric(18,2)
    generated always as (
      case type
        when 'withdraw'     then -amount
        when 'transfer_out' then -amount
        else amount            -- initial / deposit / transfer_in / adjustment
      end
    ) stored
);

create index if not exists idx_acct_txn_account on public.account_transactions(account_id, transaction_date);
create index if not exists idx_acct_txn_stock   on public.account_transactions(stock_transaction_id);

-- 一個帳戶只能有一筆期初餘額
create unique index if not exists uniq_acct_initial
  on public.account_transactions(account_id)
  where type = 'initial';

-- ----------------------------------------------------------------------------
-- 帳戶目前餘額(即時計算,不存快取欄位)
-- ----------------------------------------------------------------------------
create or replace view public.account_balances
with (security_invoker = on) as
select
  a.id           as account_id,
  a.owner_id,
  a.type,
  a.institution,
  a.nickname,
  a.currency,
  a.is_archived,
  coalesce(sum(t.signed_amount), 0)::numeric(18,2) as balance,
  max(t.transaction_date) as last_transaction_date
from public.accounts a
left join public.account_transactions t on t.account_id = a.id
group by a.id, a.owner_id, a.type, a.institution, a.nickname, a.currency, a.is_archived;

-- ============================================================================
-- 3. 股票
-- ============================================================================

create table if not exists public.stocks (
  symbol     text primary key,                          -- 台股用代號(2330);美股用 ticker(AAPL)
  market     text not null check (market in ('TW', 'US')),
  name       text,
  currency   text not null check (currency in ('TWD', 'USD')),
  created_at timestamptz not null default now()
);

create table if not exists public.stock_transactions (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.profiles(id) on delete cascade,
  account_id       uuid references public.accounts(id) on delete set null,  -- 交割用券商帳戶
  symbol           text not null references public.stocks(symbol) on delete restrict,
  type             text not null check (type in ('initial', 'buy', 'sell')),
  shares           numeric(18,4) not null check (shares > 0),
  price            numeric(18,4) not null check (price >= 0),   -- initial 時填目前均價
  fee              numeric(18,2) not null default 0 check (fee >= 0),
  transaction_date date not null,
  note             text,
  created_at       timestamptz not null default now()
);

create index if not exists idx_stock_txn_owner  on public.stock_transactions(owner_id, symbol, transaction_date);
create index if not exists idx_stock_txn_symbol on public.stock_transactions(symbol);

-- ----------------------------------------------------------------------------
-- 配息與配股(2026-10 加入)
--
--   dividend        現金股利。shares = 除息日持股、price = 每股配息、
--                   fee = 二代健保與匯費(美股是預扣稅),transaction_date = 除息日
--   stock_dividend  股票股利(配股)。shares = 配到的股數、price = 0,transaction_date = 除權日
--
-- 盈虧算在除息日(那天股價下跌,股利要同一天抵銷);錢真正入帳的發放日另外記在
-- pay_date,券商帳戶的連動用發放日。
--
-- 型別的 check 是建表時寫在欄位上的,create table if not exists 不會改到既有的表,
-- 所以要明確 drop 再 add,這份 SQL 才能重複執行。
-- ----------------------------------------------------------------------------
alter table public.stock_transactions
  add column if not exists pay_date date;

alter table public.stock_transactions
  drop constraint if exists stock_transactions_type_check;
alter table public.stock_transactions
  add constraint stock_transactions_type_check
  check (type in ('initial', 'buy', 'sell', 'dividend', 'stock_dividend'));

alter table public.stock_transactions
  drop constraint if exists stock_transactions_pay_date_check;
alter table public.stock_transactions
  add constraint stock_transactions_pay_date_check
  check (pay_date is null or (type = 'dividend' and pay_date >= transaction_date));

-- 同一人同一檔股票只能有一筆期初持股
create unique index if not exists uniq_stock_initial
  on public.stock_transactions(owner_id, symbol)
  where type = 'initial';

-- ----------------------------------------------------------------------------
-- 股票交易自動連動券商帳戶餘額
--   買進     → withdraw(股數 × 價格 + 手續費)
--   賣出     → deposit (股數 × 價格 − 手續費與稅)
--   現金股利 → deposit (股數 × 每股配息 − 二代健保等),日期用發放日(沒填就用除息日)
--   期初持股、配股不連動:前者是既有部位,後者沒有現金進出
-- ----------------------------------------------------------------------------
create or replace function public.sync_broker_cash()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric(18,2);
  v_type   text;
begin
  -- 先移除舊的連動紀錄(UPDATE / DELETE 時)
  if (tg_op in ('UPDATE', 'DELETE')) then
    delete from public.account_transactions where stock_transaction_id = old.id;
  end if;

  if (tg_op = 'DELETE') then
    return old;
  end if;

  -- 期初持股、配股或未指定帳戶 → 不連動
  if new.type in ('initial', 'stock_dividend') or new.account_id is null then
    return new;
  end if;

  if new.type = 'buy' then
    v_type   := 'withdraw';
    v_amount := round(new.shares * new.price, 2) + new.fee;
  else
    -- 賣出與現金股利都是存入,扣掉費用後不會是負數
    v_type   := 'deposit';
    v_amount := round(new.shares * new.price, 2) - new.fee;
    if v_amount < 0 then v_amount := 0; end if;
  end if;

  insert into public.account_transactions
    (account_id, type, amount, transaction_date, note, stock_transaction_id)
  values
    (new.account_id, v_type, v_amount,
     -- 現金股利在發放日才入帳
     case when new.type = 'dividend' then coalesce(new.pay_date, new.transaction_date)
          else new.transaction_date end,
     (case new.type when 'buy' then '買進 ' when 'sell' then '賣出 ' else '股利 ' end) || new.symbol,
     new.id);

  return new;
end;
$$;

drop trigger if exists trg_sync_broker_cash_ins on public.stock_transactions;
create trigger trg_sync_broker_cash_ins
  after insert on public.stock_transactions
  for each row execute function public.sync_broker_cash();

drop trigger if exists trg_sync_broker_cash_upd on public.stock_transactions;
create trigger trg_sync_broker_cash_upd
  after update on public.stock_transactions
  for each row execute function public.sync_broker_cash();

drop trigger if exists trg_sync_broker_cash_del on public.stock_transactions;
create trigger trg_sync_broker_cash_del
  after delete on public.stock_transactions
  for each row execute function public.sync_broker_cash();

-- ============================================================================
-- 4. 市場資料(每日自動同步寫入)
-- ============================================================================

create table if not exists public.stock_price_history (
  symbol      text not null references public.stocks(symbol) on delete cascade,
  price_date  date not null,
  close_price numeric(18,4) not null,
  updated_at  timestamptz not null default now(),
  primary key (symbol, price_date)
);

create table if not exists public.fx_rates (
  rate_date     date not null,
  from_currency text not null,
  to_currency   text not null,
  rate          numeric(18,6) not null,
  updated_at    timestamptz not null default now(),
  primary key (rate_date, from_currency, to_currency)
);

-- 每檔股票的最新收盤價
create or replace view public.latest_stock_prices
with (security_invoker = on) as
select distinct on (symbol)
  symbol, price_date, close_price
from public.stock_price_history
order by symbol, price_date desc;

-- 最新匯率
create or replace view public.latest_fx_rates
with (security_invoker = on) as
select distinct on (from_currency, to_currency)
  from_currency, to_currency, rate_date, rate
from public.fx_rates
order by from_currency, to_currency, rate_date desc;

-- ----------------------------------------------------------------------------
-- 全市場代號字典 — 新增交易時打代號就能帶出商品名稱
--
-- 跟 stocks 是兩回事:stocks 只放這個家庭真的有交易過的標的(被 stock_transactions
-- 以外鍵參照),這張則是整個市場的對照表,每日同步時整批 upsert 進來。
-- 只新增不刪除 —— 某天來源少回幾檔時,不該把既有的字典砍掉。
-- ----------------------------------------------------------------------------
create table if not exists public.market_symbols (
  symbol     text not null,
  market     text not null check (market in ('TW', 'US')),
  name       text not null,
  updated_at timestamptz not null default now(),
  primary key (market, symbol)
);

-- ----------------------------------------------------------------------------
-- 休市日 — 每日同步從證交所抓整年的行事曆寫進來
--
-- 日曆靠它在國定假日那格寫上節日名稱,也讓「休市」不必再從「那天沒有收盤價」
-- 去猜 —— 猜的方法分不出國定假日與收盤價還沒公布,而且未來的假日根本猜不到。
-- 只放沒有交易的日子;證交所行事曆裡的「開始交易日」「最後交易日」要濾掉。
-- ----------------------------------------------------------------------------
create table if not exists public.market_holidays (
  market       text not null check (market in ('TW', 'US')),
  holiday_date date not null,
  name         text not null,
  updated_at   timestamptz not null default now(),
  primary key (market, holiday_date)
);

-- ============================================================================
-- 5. 每日總資產快照(首頁趨勢線資料來源)
-- ============================================================================

create table if not exists public.daily_net_worth_snapshots (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  owner_id      uuid references public.profiles(id) on delete cascade,  -- null = 全家合計
  snapshot_date date not null,
  cash_twd      numeric(18,2) not null default 0,
  stock_twd     numeric(18,2) not null default 0,
  total_twd     numeric(18,2) not null default 0,
  created_at    timestamptz not null default now()
);

create unique index if not exists uniq_snapshot
  on public.daily_net_worth_snapshots(
    household_id,
    coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid),
    snapshot_date
  );

create index if not exists idx_snapshot_date
  on public.daily_net_worth_snapshots(household_id, snapshot_date);

-- ----------------------------------------------------------------------------
-- 快照待重算清單 — 交易一有變動就記下「從哪天開始要重算」
--
-- 快照是衍生資料,每日同步平常只重算今天與昨天。新增一筆日期在過去的交易、
-- 或是編輯、刪除舊交易之後,那天到今天的快照都會停在舊值 —— 以前要手動跑回填。
--
-- 現在由觸發器記下每個家庭最早受影響的日期,下一次每日同步看到就從那天重算,
-- 算完再清掉。記錄的是「最早」的日期,多次變動會合併成一筆,不會越積越多。
--
-- 沒有任何 policy:使用者讀不到也寫不了,只有觸發器(security definer)
-- 與同步腳本(service_role)碰得到。
-- ----------------------------------------------------------------------------
create table if not exists public.snapshot_rebuild_requests (
  household_id uuid primary key references public.households(id) on delete cascade,
  from_date    date not null,
  requested_at timestamptz not null default now()
);

create or replace function public.request_snapshot_rebuild()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner     uuid;
  v_date      date;
  v_household uuid;
begin
  -- DELETE 時 new 是 null、INSERT 時 old 是 null;UPDATE 取新舊兩個日期中較早的
  if tg_table_name = 'stock_transactions' then
    v_owner := coalesce(new.owner_id, old.owner_id);
  else
    select a.owner_id into v_owner
    from public.accounts a
    where a.id = coalesce(new.account_id, old.account_id);
  end if;

  v_date := least(new.transaction_date, old.transaction_date);

  select p.household_id into v_household from public.profiles p where p.id = v_owner;

  -- 帳戶整個被刪除時(cascade)找不到擁有者,那些快照會在下一次回填時處理
  if v_household is null or v_date is null then
    return null;
  end if;

  insert into public.snapshot_rebuild_requests (household_id, from_date, requested_at)
  values (v_household, v_date, now())
  on conflict (household_id) do update
    set from_date    = least(snapshot_rebuild_requests.from_date, excluded.from_date),
        requested_at = now();

  return null;
end;
$$;

drop trigger if exists trg_rebuild_stock on public.stock_transactions;
create trigger trg_rebuild_stock
  after insert or update or delete on public.stock_transactions
  for each row execute function public.request_snapshot_rebuild();

drop trigger if exists trg_rebuild_account on public.account_transactions;
create trigger trg_rebuild_account
  after insert or update or delete on public.account_transactions
  for each row execute function public.request_snapshot_rebuild();

-- ============================================================================
-- 6. Row Level Security
--    讀:同一家庭的成員都看得到(支援首頁「全家」視角)
--    寫:只能改自己的資料
-- ============================================================================

alter table public.households                enable row level security;
alter table public.profiles                  enable row level security;
alter table public.accounts                  enable row level security;
alter table public.account_transactions      enable row level security;
alter table public.stocks                    enable row level security;
alter table public.stock_transactions        enable row level security;
alter table public.stock_price_history       enable row level security;
alter table public.fx_rates                  enable row level security;
alter table public.market_symbols            enable row level security;
alter table public.market_holidays           enable row level security;
alter table public.daily_net_worth_snapshots enable row level security;
alter table public.snapshot_rebuild_requests enable row level security;

-- households ------------------------------------------------------------------
drop policy if exists households_select on public.households;
create policy households_select on public.households
  for select to authenticated
  using (id = public.current_household_id());

drop policy if exists households_insert on public.households;
create policy households_insert on public.households
  for insert to authenticated
  with check (true);

drop policy if exists households_update on public.households;
create policy households_update on public.households
  for update to authenticated
  using (id = public.current_household_id());

-- profiles --------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or household_id = public.current_household_id());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- accounts --------------------------------------------------------------------
drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts
  for select to authenticated
  using (owner_id in (select public.household_member_ids()));

drop policy if exists accounts_write on public.accounts;
create policy accounts_write on public.accounts
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- account_transactions --------------------------------------------------------
drop policy if exists acct_txn_select on public.account_transactions;
create policy acct_txn_select on public.account_transactions
  for select to authenticated
  using (exists (
    select 1 from public.accounts a
    where a.id = account_id
      and a.owner_id in (select public.household_member_ids())
  ));

drop policy if exists acct_txn_write on public.account_transactions;
create policy acct_txn_write on public.account_transactions
  for all to authenticated
  using (exists (
    select 1 from public.accounts a where a.id = account_id and a.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.accounts a where a.id = account_id and a.owner_id = auth.uid()
  ));

-- stock_transactions ----------------------------------------------------------
drop policy if exists stock_txn_select on public.stock_transactions;
create policy stock_txn_select on public.stock_transactions
  for select to authenticated
  using (owner_id in (select public.household_member_ids()));

drop policy if exists stock_txn_write on public.stock_transactions;
create policy stock_txn_write on public.stock_transactions
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- 市場資料:所有登入者可讀;寫入由同步腳本以 service role 執行(繞過 RLS)
drop policy if exists stocks_select on public.stocks;
create policy stocks_select on public.stocks
  for select to authenticated using (true);

drop policy if exists stocks_insert on public.stocks;
create policy stocks_insert on public.stocks
  for insert to authenticated with check (true);

drop policy if exists prices_select on public.stock_price_history;
create policy prices_select on public.stock_price_history
  for select to authenticated using (true);

drop policy if exists fx_select on public.fx_rates;
create policy fx_select on public.fx_rates
  for select to authenticated using (true);

-- 代號字典是公開的上市櫃資料,但只開放給已登入者查
-- (自動完成的 API 不另外檢查身分,就靠這條政策把未登入的請求擋成空結果)
drop policy if exists market_symbols_select on public.market_symbols;
create policy market_symbols_select on public.market_symbols
  for select to authenticated using (true);

drop policy if exists market_holidays_select on public.market_holidays;
create policy market_holidays_select on public.market_holidays
  for select to authenticated using (true);

-- daily_net_worth_snapshots ---------------------------------------------------
drop policy if exists snapshot_select on public.daily_net_worth_snapshots;
create policy snapshot_select on public.daily_net_worth_snapshots
  for select to authenticated
  using (household_id = public.current_household_id());

-- ============================================================================
-- 7. 便利函式:建立家庭並把自己加入
-- ============================================================================

create or replace function public.create_household(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.households (name) values (p_name) returning id into v_id;
  update public.profiles set household_id = v_id where id = auth.uid();
  return v_id;
end;
$$;

-- 用邀請碼(家庭 id)加入既有家庭
create or replace function public.join_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.households where id = p_household_id) then
    raise exception '找不到這個家庭';
  end if;
  update public.profiles set household_id = p_household_id where id = auth.uid();
end;
$$;

-- ============================================================================
-- 8. 收斂 SECURITY DEFINER 函式的執行權限
--
-- Postgres 預設會把函式的 EXECUTE 權限授予 PUBLIC,這代表未登入的 anon
-- 也能透過 /rest/v1/rpc/... 呼叫它們。這裡逐一收回,只留下真正需要的。
-- (Supabase 的資料庫安全檢查會抓這一項)
-- ============================================================================

-- 觸發器專用函式 — 完全不該從 API 呼叫
-- 觸發器的執行權限在建立時就檢查完畢,收回後觸發器照常運作
revoke all on function public.handle_new_user()   from public, anon, authenticated;
revoke all on function public.sync_broker_cash()  from public, anon, authenticated;
revoke all on function public.request_snapshot_rebuild() from public, anon, authenticated;

-- RLS 政策的輔助函式 — 政策評估時由登入者的角色呼叫,所以 authenticated 需要保留
revoke all on function public.current_household_id()  from public, anon;
revoke all on function public.household_member_ids()  from public, anon;
grant execute on function public.current_household_id() to authenticated;
grant execute on function public.household_member_ids() to authenticated;

-- 前端會直接呼叫的 RPC — 只開放給已登入者
-- anon 呼叫 create_household 時 auth.uid() 為 null,會留下沒有主人的家庭資料
revoke all on function public.create_household(text)  from public, anon;
revoke all on function public.join_household(uuid)    from public, anon;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.join_household(uuid)   to authenticated;
