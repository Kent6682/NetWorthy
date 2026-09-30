'use server';

import { revalidatePath } from 'next/cache';
import { parseNumberInput } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import type { StockTxnType } from '@/lib/holdings';

type Result = { error?: string; ok?: boolean };

/** 台股代號是數字;美股是英文字母 */
function normalizeSymbol(raw: string, market: string): string {
  const s = raw.trim().toUpperCase();
  return market === 'TW' ? s.replace(/[^0-9A-Z]/g, '') : s.replace(/[^A-Z.\-]/g, '');
}

interface StockTxnFields {
  market: 'TW' | 'US';
  symbol: string;
  name: string | null;
  type: StockTxnType;
  shares: number;
  price: number;
  fee: number;
  transactionDate: string;
  /** 現金股利的發放日,其他類型一律 null */
  payDate: string | null;
  accountId: string | null;
}

const STOCK_TXN_TYPES: StockTxnType[] = ['initial', 'buy', 'sell', 'dividend', 'stock_dividend'];

/** 新增與編輯共用的表單解析與驗證 */
function parseStockForm(formData: FormData): { error: string } | StockTxnFields {
  const market = String(formData.get('market') ?? 'TW');
  const symbol = normalizeSymbol(String(formData.get('symbol') ?? ''), market);
  const name = String(formData.get('name') ?? '').trim() || null;
  const type = String(formData.get('type') ?? '') as StockTxnType;
  // 股數與手續費的輸入框帶千分位,要先拿掉逗號
  const shares = parseNumberInput(String(formData.get('shares') ?? ''));
  const price = parseNumberInput(String(formData.get('price') ?? ''));
  const feeRaw = parseNumberInput(String(formData.get('fee') ?? ''));
  const fee = Number.isNaN(feeRaw) ? 0 : feeRaw;
  const transactionDate = String(formData.get('transaction_date') ?? '');
  const payDateRaw = String(formData.get('pay_date') ?? '').trim();
  const linkAccount = formData.get('link_account') === 'on';
  const accountIdRaw = String(formData.get('account_id') ?? '');

  if (!symbol) return { error: '請填寫股票代號' };
  if (market !== 'TW' && market !== 'US') return { error: '請選擇市場' };
  if (!STOCK_TXN_TYPES.includes(type)) return { error: '請選擇交易類型' };
  if (!Number.isFinite(shares) || shares <= 0) {
    return { error: type === 'stock_dividend' ? '配到的股數必須大於 0' : '股數必須大於 0' };
  }
  if (!transactionDate) return { error: '請填寫日期' };

  // 配股沒有價格、費用與現金進出;其他類型才檢查這些欄位
  if (type !== 'stock_dividend') {
    if (!Number.isFinite(price) || price < 0) return { error: '價格不能是負數' };
    if (type === 'dividend' && price <= 0) return { error: '請填寫每股配息' };
    if (!Number.isFinite(fee) || fee < 0) return { error: '費用不能是負數' };
  }

  const payDate = type === 'dividend' && payDateRaw ? payDateRaw : null;
  if (payDate && payDate < transactionDate) return { error: '發放日不能早於除息日' };

  // 期初持股與配股沒有現金進出,不連動帳戶;其他看使用者有沒有勾選連動
  const noCash = type === 'initial' || type === 'stock_dividend';
  const accountId = noCash || !linkAccount ? null : accountIdRaw || null;
  if (!noCash && linkAccount && !accountId) {
    return { error: '要連動帳戶餘額的話,請選擇券商帳戶' };
  }

  return {
    market,
    symbol,
    name,
    type,
    shares,
    price: type === 'stock_dividend' ? 0 : price,
    fee: noCash ? 0 : fee,
    transactionDate,
    payDate,
    accountId,
  };
}

/** 確保 stocks 字典裡有這檔 */
async function ensureStock(
  supabase: Awaited<ReturnType<typeof createClient>>,
  f: StockTxnFields
): Promise<string | null> {
  const { error } = await supabase.from('stocks').upsert(
    {
      symbol: f.symbol,
      market: f.market,
      name: f.name,
      currency: f.market === 'TW' ? 'TWD' : 'USD',
    },
    { onConflict: 'symbol', ignoreDuplicates: true }
  );
  return error ? `股票代號建立失敗:${error.message}` : null;
}

function toRow(f: StockTxnFields) {
  return {
    account_id: f.accountId,
    symbol: f.symbol,
    type: f.type,
    shares: f.shares,
    price: f.price,
    fee: f.fee,
    transaction_date: f.transactionDate,
    pay_date: f.payDate,
  };
}

/**
 * 股票交易一變動,會連動到的頁面全部重新整理:
 * 持股與均價(股票頁)、券商帳戶餘額(帳戶頁)、總覽的四格與年度表、日曆。
 */
function revalidateAll() {
  revalidatePath('/stocks');
  revalidatePath('/accounts', 'layout');
  revalidatePath('/');
  revalidatePath('/calendar');
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

  const f = parseStockForm(formData);
  if ('error' in f) return f;

  const stockError = await ensureStock(supabase, f);
  if (stockError) return { error: stockError };

  const { error } = await supabase
    .from('stock_transactions')
    .insert({ owner_id: user.id, ...toRow(f) });

  if (error) {
    if (error.code === '23505') {
      return { error: `${f.symbol} 已經有一筆期初持股了,請改用買進/賣出記錄後續變動` };
    }
    return { error: `新增失敗:${error.message}` };
  }

  revalidateAll();
  return { ok: true };
}

/**
 * 編輯股票交易。
 *
 * 連動是資料庫層處理的,這裡只要改那一列:
 *   - 券商帳戶:sync_broker_cash() 觸發器會刪掉舊的連動紀錄、依新內容重建
 *   - 快照:request_snapshot_rebuild() 觸發器記下新舊日期中較早的那天,
 *     下一次每日同步從那天重算趨勢圖與日曆
 *   - 持股、均價、已實現、年度表:每次都從交易重算,自然跟著變
 */
export async function updateStockTransaction(_prev: unknown, formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: '請先登入' };

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: '找不到要編輯的交易' };

  const f = parseStockForm(formData);
  if ('error' in f) return f;

  const stockError = await ensureStock(supabase, f);
  if (stockError) return { error: stockError };

  // RLS 只允許改自己的;多帶 owner_id 讓「改到別人的」直接變成找不到,而不是靜默失敗
  const { data, error } = await supabase
    .from('stock_transactions')
    .update(toRow(f))
    .eq('id', id)
    .eq('owner_id', user.id)
    .select('id');

  if (error) {
    if (error.code === '23505') {
      return { error: `${f.symbol} 已經有一筆期初持股了,每人每檔只能有一筆` };
    }
    return { error: `儲存失敗:${error.message}` };
  }
  if (!data || data.length === 0) {
    return { error: '找不到這筆交易,或它不是你的交易(只能編輯自己的)' };
  }

  revalidateAll();
  return { ok: true };
}

/** 刪除股票交易 — 連動產生的帳戶收支會由 trigger 一併移除 */
export async function deleteStockTransaction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await supabase.from('stock_transactions').delete().eq('id', id);

  revalidateAll();
}
