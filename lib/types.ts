export type AccountType = 'bank' | 'broker_cash';

export type AccountTxnType =
  | 'initial'
  | 'deposit'
  | 'withdraw'
  | 'transfer_in'
  | 'transfer_out'
  | 'adjustment';

export type Currency = 'TWD' | 'USD';
export type Market = 'TW' | 'US';

export interface Profile {
  id: string;
  household_id: string | null;
  display_name: string;
}

export interface Account {
  id: string;
  owner_id: string;
  type: AccountType;
  institution: string;
  nickname: string | null;
  currency: Currency;
  is_archived: boolean;
}

export interface AccountBalance extends Account {
  account_id: string;
  balance: number;
  last_transaction_date: string | null;
}

export interface AccountTransaction {
  id: string;
  account_id: string;
  type: AccountTxnType;
  amount: number;
  signed_amount: number;
  transaction_date: string;
  counterpart_account_id: string | null;
  note: string | null;
  stock_transaction_id: string | null;
  created_at: string;
}

export interface Stock {
  symbol: string;
  market: Market;
  name: string | null;
  currency: Currency;
}

export interface LatestPrice {
  symbol: string;
  price_date: string;
  close_price: number;
}

export interface NetWorthSnapshot {
  snapshot_date: string;
  cash_twd: number;
  stock_twd: number;
  total_twd: number;
  owner_id: string | null;
}

/** 帳戶類型的中文標籤 */
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  bank: '銀行',
  broker_cash: '券商虛擬帳戶',
};

/** 帳戶收支類型的中文標籤 */
export const ACCOUNT_TXN_LABEL: Record<AccountTxnType, string> = {
  initial: '期初餘額',
  deposit: '存入',
  withdraw: '提出',
  transfer_in: '轉入',
  transfer_out: '轉出',
  adjustment: '對帳調整',
};

export const STOCK_TXN_LABEL = {
  initial: '期初持股',
  buy: '買進',
  sell: '賣出',
} as const;

/** 登入/註冊 Server Action 的回傳型別 */
export type AuthResult = { error?: string; notice?: string };
