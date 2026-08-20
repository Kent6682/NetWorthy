'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

type Result = { error?: string; ok?: boolean };

/** 台股代號是數字;美股是英文字母 */
function normalizeSymbol(raw: string, market: string): string {
  const s = raw.trim().toUpperCase();
  return market === 'TW' ? s.replace(/[^0-9A-Z]/g, '') : s.replace(/[^A-Z.\-]/g, '');
}

/**
 * 新增股票交易(期初持股 / 買進 / 賣出)。
 * 股票代號如果還沒建過,會自動補進 stocks 字典。
 * 買賣會由資料庫的 trigger 自動連動券商帳戶餘額;期初持股不連動。
 */
export async function addStockTransaction(_prev: unknown, formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: '請先登入' };

  const market = String(formData.get('market') ?? 'TW');
  const symbol = normalizeSymbol(String(formData.get('symbol') ?? ''), market);
  const name = String(formData.get('name') ?? '').trim() || null;
  const type = String(formData.get('type') ?? '');
  const shares = Number(formData.get('shares') ?? 0);
  const price = Number(formData.get('price') ?? 0);
  const fee = Number(formData.get('fee') ?? 0);
  const transactionDate = String(formData.get('transaction_date') ?? '');
  const linkAccount = formData.get('link_account') === 'on';
  const accountIdRaw = String(formData.get('account_id') ?? '');

  if (!symbol) return { error: '請填寫股票代號' };
  if (!['TW', 'US'].includes(market)) return { error: '請選擇市場' };
  if (!['initial', 'buy', 'sell'].includes(type)) return { error: '請選擇交易類型' };
  if (!Number.isFinite(shares) || shares <= 0) return { error: '股數必須大於 0' };
  if (!Number.isFinite(price) || price < 0) return { error: '價格不能是負數' };
  if (!Number.isFinite(fee) || fee < 0) return { error: '手續費不能是負數' };
  if (!transactionDate) return { error: '請填寫交易日期' };

  // 期初持股不連動帳戶;買賣則看使用者有沒有勾選連動
  const accountId = type === 'initial' || !linkAccount ? null : accountIdRaw || null;
  if (type !== 'initial' && linkAccount && !accountId) {
    return { error: '要連動帳戶餘額的話,請選擇交割用的券商帳戶' };
  }

  // 確保 stocks 字典裡有這檔
  const { error: stockError } = await supabase.from('stocks').upsert(
    {
      symbol,
      market,
      name,
      currency: market === 'TW' ? 'TWD' : 'USD',
    },
    { onConflict: 'symbol', ignoreDuplicates: true }
  );
  if (stockError) return { error: `股票代號建立失敗:${stockError.message}` };

  const { error } = await supabase.from('stock_transactions').insert({
    owner_id: user.id,
    account_id: accountId,
    symbol,
    type,
    shares,
    price,
    fee: type === 'initial' ? 0 : fee,
    transaction_date: transactionDate,
  });

  if (error) {
    if (error.code === '23505') {
      return { error: `${symbol} 已經有一筆期初持股了,請改用買進/賣出記錄後續變動` };
    }
    return { error: `新增失敗:${error.message}` };
  }

  revalidatePath('/stocks');
  revalidatePath('/accounts');
  revalidatePath('/');
  return { ok: true };
}

/** 刪除股票交易 — 連動產生的帳戶收支會由 trigger 一併移除 */
export async function deleteStockTransaction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await supabase.from('stock_transactions').delete().eq('id', id);

  revalidatePath('/stocks');
  revalidatePath('/accounts');
  revalidatePath('/');
}
