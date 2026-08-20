'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { AccountTxnType } from '@/lib/types';

type Result = { error?: string; ok?: boolean };

/** 新增帳戶,同時寫入一筆期初餘額 */
export async function createAccount(_prev: unknown, formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: '請先登入' };

  const type = String(formData.get('type') ?? '');
  const institution = String(formData.get('institution') ?? '').trim();
  const nickname = String(formData.get('nickname') ?? '').trim() || null;
  const currency = String(formData.get('currency') ?? 'TWD');
  const initialBalance = Number(formData.get('initial_balance') ?? 0);
  const openedOn = String(formData.get('opened_on') ?? '');

  if (!['bank', 'broker_cash'].includes(type)) return { error: '請選擇帳戶類型' };
  if (!institution) return { error: '請填寫機構名稱' };
  if (!openedOn) return { error: '請填寫期初日期' };
  if (!Number.isFinite(initialBalance) || initialBalance < 0) {
    return { error: '期初餘額必須是 0 或正數' };
  }

  const { data: account, error } = await supabase
    .from('accounts')
    .insert({ owner_id: user.id, type, institution, nickname, currency })
    .select('id')
    .single();

  if (error || !account) return { error: `建立帳戶失敗:${error?.message}` };

  const { error: txnError } = await supabase.from('account_transactions').insert({
    account_id: account.id,
    type: 'initial',
    amount: initialBalance,
    transaction_date: openedOn,
    note: '期初餘額',
  });

  if (txnError) return { error: `期初餘額寫入失敗:${txnError.message}` };

  revalidatePath('/accounts');
  revalidatePath('/');
  return { ok: true };
}

/** 新增一筆收支(存入/提出/對帳調整) */
export async function addAccountTransaction(
  _prev: unknown,
  formData: FormData
): Promise<Result> {
  const supabase = await createClient();

  const accountId = String(formData.get('account_id') ?? '');
  const type = String(formData.get('type') ?? '') as AccountTxnType;
  const rawAmount = Number(formData.get('amount') ?? 0);
  const transactionDate = String(formData.get('transaction_date') ?? '');
  const note = String(formData.get('note') ?? '').trim() || null;

  if (!accountId) return { error: '缺少帳戶' };
  if (!['deposit', 'withdraw', 'adjustment'].includes(type)) {
    return { error: '請選擇收支類型' };
  }
  if (!transactionDate) return { error: '請填寫日期' };
  if (!Number.isFinite(rawAmount) || rawAmount === 0) return { error: '請填寫金額' };

  // 存入/提出一律存正數,方向由 type 決定;對帳調整允許負數
  const amount = type === 'adjustment' ? rawAmount : Math.abs(rawAmount);

  const { error } = await supabase.from('account_transactions').insert({
    account_id: accountId,
    type,
    amount,
    transaction_date: transactionDate,
    note,
  });

  if (error) return { error: `新增失敗:${error.message}` };

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath('/accounts');
  revalidatePath('/');
  return { ok: true };
}

/** 帳戶之間轉帳:成對寫入 transfer_out 與 transfer_in */
export async function transferBetweenAccounts(
  _prev: unknown,
  formData: FormData
): Promise<Result> {
  const supabase = await createClient();

  const fromId = String(formData.get('from_account_id') ?? '');
  const toId = String(formData.get('to_account_id') ?? '');
  const amount = Math.abs(Number(formData.get('amount') ?? 0));
  const transactionDate = String(formData.get('transaction_date') ?? '');
  const note = String(formData.get('note') ?? '').trim() || null;

  if (!fromId || !toId) return { error: '請選擇轉出與轉入帳戶' };
  if (fromId === toId) return { error: '轉出與轉入不能是同一個帳戶' };
  if (!Number.isFinite(amount) || amount <= 0) return { error: '請填寫金額' };
  if (!transactionDate) return { error: '請填寫日期' };

  const { error } = await supabase.from('account_transactions').insert([
    {
      account_id: fromId,
      type: 'transfer_out',
      amount,
      transaction_date: transactionDate,
      counterpart_account_id: toId,
      note,
    },
    {
      account_id: toId,
      type: 'transfer_in',
      amount,
      transaction_date: transactionDate,
      counterpart_account_id: fromId,
      note,
    },
  ]);

  if (error) return { error: `轉帳失敗:${error.message}` };

  revalidatePath('/accounts');
  revalidatePath('/');
  return { ok: true };
}

/** 刪除一筆收支;股票連動產生的紀錄要回股票頁刪原交易 */
export async function deleteAccountTransaction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const id = String(formData.get('id') ?? '');
  const accountId = String(formData.get('account_id') ?? '');
  if (!id) return;

  await supabase.from('account_transactions').delete().eq('id', id).is('stock_transaction_id', null);

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath('/accounts');
  revalidatePath('/');
}

/** 封存帳戶(不刪除歷史紀錄) */
export async function archiveAccount(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await supabase.from('accounts').update({ is_archived: true }).eq('id', id);

  revalidatePath('/accounts');
  revalidatePath('/');
}
