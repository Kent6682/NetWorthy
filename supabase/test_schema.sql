\set ON_ERROR_STOP on
begin;

-- 建立兩位家庭成員
insert into auth.users (id, email, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111', 'kent@example.com', '{"display_name":"Kent"}'),
       ('22222222-2222-2222-2222-222222222222', 'wife@example.com', '{"display_name":"太太"}');

insert into public.households (id, name) values ('99999999-9999-9999-9999-999999999999', 'Teng 家');
update public.profiles set household_id = '99999999-9999-9999-9999-999999999999';

\echo '--- 1. profiles 是否由 trigger 自動建立 ---'
select id, display_name, household_id from public.profiles order by display_name;

-- 帳戶
insert into public.accounts (id, owner_id, type, institution, currency) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','bank','國泰世華','TWD'),
  ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','broker_cash','元大證券','TWD');

insert into public.account_transactions (account_id, type, amount, transaction_date) values
  ('aaaaaaaa-0000-0000-0000-000000000001','initial', 1000000, '2026-01-01'),
  ('aaaaaaaa-0000-0000-0000-000000000002','initial', 1000000, '2026-01-01');

insert into public.stocks (symbol, market, name, currency) values
  ('2330','TW','台積電','TWD'), ('AAPL','US','Apple','USD');

\echo '--- 2. 期初持股不應連動券商帳戶 ---'
insert into public.stock_transactions (owner_id, account_id, symbol, type, shares, price, transaction_date)
values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000002','2330','initial', 2000, 550, '2026-01-01');
select count(*) as "連動筆數(應為0)" from public.account_transactions where stock_transaction_id is not null;

\echo '--- 3. 買進應產生 withdraw ---'
insert into public.stock_transactions (id, owner_id, account_id, symbol, type, shares, price, fee, transaction_date)
values ('bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000002','2330','buy', 1000, 600, 855, '2026-02-10');
select type, amount, signed_amount, note from public.account_transactions where stock_transaction_id = 'bbbbbbbb-0000-0000-0000-000000000001';

\echo '--- 4. 賣出應產生 deposit ---'
insert into public.stock_transactions (id, owner_id, account_id, symbol, type, shares, price, fee, transaction_date)
values ('bbbbbbbb-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000002','2330','sell', 500, 700, 1500, '2026-03-15');
select type, amount, signed_amount, note from public.account_transactions where stock_transaction_id = 'bbbbbbbb-0000-0000-0000-000000000002';

\echo '--- 5. 券商帳戶餘額(預期 1000000 - 600855 + 348500 = 747645)---'
select institution, balance from public.account_balances where account_id = 'aaaaaaaa-0000-0000-0000-000000000002';

\echo '--- 6. 修改買進交易,連動紀錄應同步更新(不重複)---'
update public.stock_transactions set shares = 2000 where id = 'bbbbbbbb-0000-0000-0000-000000000001';
select count(*) as "連動筆數(應為1)", max(amount) as "金額(應為1200855)"
from public.account_transactions where stock_transaction_id = 'bbbbbbbb-0000-0000-0000-000000000001';

\echo '--- 7. 刪除股票交易,連動紀錄應一併消失 ---'
delete from public.stock_transactions where id = 'bbbbbbbb-0000-0000-0000-000000000001';
select count(*) as "連動筆數(應為0)" from public.account_transactions where stock_transaction_id = 'bbbbbbbb-0000-0000-0000-000000000001';

\echo '--- 8. adjustment 允許負數 ---'
insert into public.account_transactions (account_id, type, amount, transaction_date, note)
values ('aaaaaaaa-0000-0000-0000-000000000001','adjustment', -320, '2026-04-01', '跨行手續費漏記');
select balance from public.account_balances where account_id = 'aaaaaaaa-0000-0000-0000-000000000001';

\echo '--- 9. 同一帳戶不可有第二筆 initial ---'
savepoint sp1;
insert into public.account_transactions (account_id, type, amount, transaction_date)
values ('aaaaaaaa-0000-0000-0000-000000000001','initial', 999, '2026-04-01');
rollback to sp1;

\echo '--- 10. deposit 不可為負數 ---'
savepoint sp2;
insert into public.account_transactions (account_id, type, amount, transaction_date)
values ('aaaaaaaa-0000-0000-0000-000000000001','deposit', -100, '2026-04-01');
rollback to sp2;

rollback;
