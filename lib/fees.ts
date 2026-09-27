/**
 * 台股手續費與證交稅的預估 —— 只用來幫表單帶出預設值,使用者可以改。
 *
 * 券商折扣、電子下單優惠、零股低消每家都不一樣,這裡照牌告費率算:
 * 使用者的券商有折扣時自己改掉就好,比留白讓人自己算方便。
 *
 *   手續費  成交金額 × 0.1425%,無條件捨去,整股最低 20 元
 *   證交稅  只有賣出要繳,無條件捨去
 *           一般股票 0.3%、ETF 0.1%、債券 ETF 停徵(至 2026-12-31)
 */

export const TW_FEE_RATE = 0.001425;
export const TW_MIN_FEE = 20;

/** 債券 ETF 證交稅停徵的最後一天。延長的話改這裡 */
export const BOND_ETF_TAX_EXEMPT_UNTIL = '2026-12-31';

export interface FeeEstimate {
  fee: number;
  tax: number;
  total: number;
  /** 證交稅用的是哪一種費率,給畫面顯示 */
  taxLabel: string;
}

/**
 * 依代號判斷證交稅率。
 * 台股 ETF 的代號都是 00 開頭,債券 ETF 再以 B 結尾(例如 00687B)。
 */
export function twSellTaxRate(symbol: string, date: string): { rate: number; label: string } {
  const s = symbol.trim().toUpperCase();
  if (s.startsWith('00') && s.endsWith('B')) {
    return date <= BOND_ETF_TAX_EXEMPT_UNTIL
      ? { rate: 0, label: '債券 ETF 免徵' }
      : { rate: 0.001, label: 'ETF 0.1%' };
  }
  if (s.startsWith('00')) return { rate: 0.001, label: 'ETF 0.1%' };
  return { rate: 0.003, label: '股票 0.3%' };
}

export function estimateTwFee(
  type: 'buy' | 'sell',
  symbol: string,
  shares: number,
  price: number,
  date: string
): FeeEstimate | null {
  const amount = shares * price;
  if (!Number.isFinite(amount) || amount <= 0) return null;

  // 先四捨五入到分,避免 16000 × 124.4 這種浮點數誤差讓捨去少一塊
  const cents = (v: number) => Math.round(v * 100) / 100;

  const fee = Math.max(TW_MIN_FEE, Math.floor(cents(amount * TW_FEE_RATE)));

  if (type === 'buy') return { fee, tax: 0, total: fee, taxLabel: '' };

  const { rate, label } = twSellTaxRate(symbol, date);
  const tax = Math.floor(cents(amount * rate));
  return { fee, tax, total: fee + tax, taxLabel: label };
}
