import { formatNumber } from '@/lib/format';
import type { YearRow } from '@/lib/yearly';

/**
 * 總覽下方的年度損益表。
 *
 * 每一列可以點開看「期末 − 期初 − 買入 + 賣出」的明細,方便拿券商對帳單逐項核對。
 * 用原生 <details>,不需要任何 client JS。
 */

function signed(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return '0';
  return `${rounded > 0 ? '+' : '−'}${formatNumber(Math.abs(rounded))}`;
}

function tone(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? 'pos' : rounded < 0 ? 'neg' : '';
}

function Breakdown({ row }: { row: YearRow }) {
  // 正負號寫在標籤上,金額本身不帶號,讀起來像一條直式算式
  const lines: [string, number][] = [
    ['期末股票市值', row.endValue],
    ['− 期初股票市值', row.startValue],
    ['− 買入(含期初持股與手續費)', row.bought],
    ['＋ 賣出實收(已扣費稅)', row.sold],
    ['＋ 股利實收(已扣二代健保等)', row.dividends],
  ];

  return (
    <div className="yearly-breakdown">
      {lines.map(([label, value]) => (
        <div key={label} className="yearly-line">
          <span>{label}</span>
          <span className="tnum">{formatNumber(Math.round(value))}</span>
        </div>
      ))}
      <div className="yearly-line" data-strong="true">
        <span>＝ 總損益</span>
        <span className={`tnum ${tone(row.total)}`}>{signed(row.total)}</span>
      </div>
      <div className="yearly-line" data-sub="true">
        <span>其中已實現</span>
        <span className={`tnum ${tone(row.realized)}`}>{signed(row.realized)}</span>
      </div>
      {Math.round(row.dividends) !== 0 && (
        <>
          <div className="yearly-line" data-sub="deep">
            <span>買賣</span>
            <span className={`tnum ${tone(row.tradingRealized)}`}>{signed(row.tradingRealized)}</span>
          </div>
          <div className="yearly-line" data-sub="deep">
            <span>股利</span>
            <span className={`tnum ${tone(row.dividends)}`}>{signed(row.dividends)}</span>
          </div>
        </>
      )}
      <div className="yearly-line" data-sub="true">
        <span>其中未實現</span>
        <span className={`tnum ${tone(row.unrealized)}`}>{signed(row.unrealized)}</span>
      </div>

      {(row.tax.cashGross > 0 || row.tax.stockPar > 0) && (
        <div className="yearly-tax">
          <div className="yearly-tax-title">
            {row.year === null ? '股利所得合計' : `${row.year} 股利所得`}(報稅核對用)
          </div>
          <div className="yearly-line">
            <span>現金股利總額</span>
            <span className="tnum">{formatNumber(Math.round(row.tax.cashGross))}</span>
          </div>
          <div className="yearly-line">
            <span>股票股利(以面額 10 元計)</span>
            <span className="tnum">{formatNumber(Math.round(row.tax.stockPar))}</span>
          </div>
          <div className="yearly-line">
            <span>二代健保與預扣稅</span>
            <span className="tnum">{formatNumber(Math.round(row.tax.deductions))}</span>
          </div>
          <p className="yearly-tax-note">
            ETF 的配息含股利、利息與收益平準金,各自課稅方式不同;報稅以國稅局的所得資料為準,這裡用來核對有沒有漏列。
          </p>
        </div>
      )}
    </div>
  );
}

function Row({ row, label }: { row: YearRow; label: string }) {
  return (
    <details className="yearly-row" data-total={row.year === null}>
      <summary className="yearly-grid">
        <span className="yearly-year">{label}</span>
        <span className={`tnum ${tone(row.unrealized)}`}>{signed(row.unrealized)}</span>
        <span className={`tnum ${tone(row.realized)}`}>{signed(row.realized)}</span>
        <span className={`tnum font-semibold ${tone(row.total)}`}>{signed(row.total)}</span>
      </summary>
      <Breakdown row={row} />
    </details>
  );
}

export default function YearlyPnl({
  rows,
  total,
  today,
}: {
  rows: YearRow[];
  total: YearRow | null;
  today: string;
}) {
  if (rows.length === 0 || !total) return null;

  const thisYear = Number(today.slice(0, 4));

  return (
    <div className="card-flush card-pad">
      <h2 className="section-title">年度損益</h2>
      <p className="eyebrow mt-0.5">只算股票,不含現金;點一列看明細</p>

      <div className="yearly-grid yearly-head mt-4">
        <span>年度</span>
        <span>未實現</span>
        <span>已實現</span>
        <span>合計</span>
      </div>

      {/* 新的年份在上面 */}
      {[...rows].reverse().map((r) => (
        <Row
          key={r.year}
          row={r}
          label={r.year === thisYear ? `${r.year} 至今` : String(r.year)}
        />
      ))}
      <Row row={total} label="全部" />

      <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        未實現是<strong style={{ color: 'var(--text-secondary)' }}>當年的變動</strong>
        (年底帳面 − 年初帳面),所以各年可以直接相加。賣出那一年,之前累積的帳面獲利會從未實現搬到已實現,
        那年的未實現可能是負的,但那不是虧損。
        期初是前一年 12/31 收盤,今年的期末是最新收盤;買入包含導入的期初持股。
      </p>
    </div>
  );
}
