/** 金額格式化(整數位,加千分位) */
export function formatMoney(value: number, currency: 'TWD' | 'USD' = 'TWD'): string {
  const symbol = currency === 'USD' ? 'US$' : 'NT$';
  const sign = value < 0 ? '-' : '';
  return `${sign}${symbol}${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
}

/** 純數字千分位,不帶幣別符號 */
export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 股數:整數就不顯示小數,零股才顯示 */
export function formatShares(value: number): string {
  const isWhole = Math.abs(value - Math.round(value)) < 1e-6;
  return formatNumber(value, isWhole ? 0 : 2);
}

/** 價格:保留 2 位小數 */
export function formatPrice(value: number): string {
  return formatNumber(value, 2);
}

/** 百分比 */
export function formatPercent(value: number, digits = 1): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

/**
 * 大額數字壓縮:1,284 / 12.9萬 / 4.2億
 * 用在首頁主數字底下的軸標籤,避免軸太寬
 */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(abs / 1e8 >= 10 ? 0 : 1)}億`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(abs / 1e4 >= 100 ? 0 : 1)}萬`;
  return `${sign}${Math.round(abs).toLocaleString('en-US')}`;
}

/** YYYY-MM-DD → 2026/8/19 */
export function formatDate(value: string): string {
  const [y, m, d] = value.split('-');
  return `${y}/${Number(m)}/${Number(d)}`;
}

/** 今天(台北時區)的 YYYY-MM-DD */
export function todayInTaipei(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
}
