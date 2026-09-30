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


\echo '--- 11. 休市日:同一市場同一天只能一筆 ---'
insert into public.market_holidays (market, holiday_date, name) values ('TW', '2026-09-25', '中秋節');
savepoint sp3;
insert into public.market_holidays (market, holiday_date, name) values ('TW', '2026-09-25', '重複');
rollback to sp3;
select count(*) as "休市日筆數(應為1)" from public.market_holidays where holiday_date = '2026-09-25';

\echo '--- 12. 新增過去的交易 → 記下待重算的日期 ---'
delete from public.snapshot_rebuild_requests;
insert into public.stock_transactions (id, owner_id, symbol, type, shares, price, fee, transaction_date)
values ('bbbbbbbb-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','2330','buy', 100, 600, 85, '2026-05-04');
select from_date as "待重算起點(應為2026-05-04)" from public.snapshot_rebuild_requests;

\echo '--- 13. 把交易日期改晚:起點取新舊兩個日期中較早的,不會被改晚 ---'
update public.stock_transactions set transaction_date = '2026-06-01' where id = 'bbbbbbbb-0000-0000-0000-000000000003';
select from_date as "待重算起點(應仍為2026-05-04)" from public.snapshot_rebuild_requests;

\echo '--- 14. 更早的變動會把起點往前推,而且一個家庭只有一筆 ---'
delete from public.snapshot_rebuild_requests;
insert into public.account_transactions (account_id, type, amount, transaction_date)
values ('aaaaaaaa-0000-0000-0000-000000000001','deposit', 500, '2026-03-01');
delete from public.stock_transactions where id = 'bbbbbbbb-0000-0000-0000-000000000003';
select count(*) as "筆數(應為1)", min(from_date) as "起點(應為2026-03-01)" from public.snapshot_rebuild_requests;


\echo '--- 15. 現金股利:在發放日存入 股數 × 每股配息 − 二代健保 ---'
insert into public.stock_transactions (id, owner_id, account_id, symbol, type, shares, price, fee, transaction_date, pay_date)
values ('bbbbbbbb-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000002','2330','dividend', 1000, 4.5, 0, '2026-06-12', '2026-07-10');
select type, amount as "金額(應為4500)", transaction_date as "日期(應為2026-07-10)", note
from public.account_transactions where stock_transaction_id = 'bbbbbbbb-0000-0000-0000-000000000004';

\echo '--- 16. 配股:不連動券商帳戶 ---'
insert into public.stock_transactions (id, owner_id, account_id, symbol, type, shares, price, fee, transaction_date)
values ('bbbbbbbb-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000002','2330','stock_dividend', 50, 0, 0, '2026-06-12');
select count(*) as "連動筆數(應為0)" from public.account_transactions where stock_transaction_id = 'bbbbbbbb-0000-0000-0000-000000000005';

\echo '--- 17. 發放日不能早於除息日(預期會噴錯)---'
savepoint sp4;
insert into public.stock_transactions (owner_id, symbol, type, shares, price, fee, transaction_date, pay_date)
values ('11111111-1111-1111-1111-111111111111','2330','dividend', 1, 1, 0, '2026-06-12', '2026-06-01');
rollback to sp4;

rollback;
