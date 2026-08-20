'use client';

import { useMemo, useState } from 'react';
import { formatCompact, formatMoney } from '@/lib/format';
import type { AssetSlice } from '@/lib/portfolio';

/**
 * 資產配置圓餅圖(甜甜圈)
 *
 * 設計規則:
 *   - 最多 6 個實際切片 + 「其他」,超過就會太碎、顏色也不夠用
 *   - 切片之間留 2px 的底色間隙(不畫外框線)
 *   - 分類色盤依固定順序取用,絕不循環
 *   - 淺色模式下部分色階對比低於 3:1,因此永遠附上數值清單
 *   - 手機:圖在上、清單在下;桌機:左右並排
 */

const SERIES = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
];
const OTHER_COLOR = 'var(--text-muted)';

const SIZE = 224;
const CENTER = SIZE / 2;
const OUTER_R = 98;
const INNER_R = 63;
const MID_R = (OUTER_R + INNER_R) / 2;
/** 2px 的底色間隙換算成弧度 */
const GAP_RAD = 2 / MID_R;

const MAX_SLICES = 6;

interface Segment {
  key: string;
  label: string;
  sublabel: string;
  value: number;
  percent: number;
  color: string;
}

function polar(angle: number, radius: number) {
  return {
    x: CENTER + radius * Math.cos(angle - Math.PI / 2),
    y: CENTER + radius * Math.sin(angle - Math.PI / 2),
  };
}

function arcPath(start: number, end: number): string {
  const largeArc = end - start > Math.PI ? 1 : 0;
  const o1 = polar(start, OUTER_R);
  const o2 = polar(end, OUTER_R);
  const i2 = polar(end, INNER_R);
  const i1 = polar(start, INNER_R);
  return [
    `M ${o1.x} ${o1.y}`,
    `A ${OUTER_R} ${OUTER_R} 0 ${largeArc} 1 ${o2.x} ${o2.y}`,
    `L ${i2.x} ${i2.y}`,
    `A ${INNER_R} ${INNER_R} 0 ${largeArc} 0 ${i1.x} ${i1.y}`,
    'Z',
  ].join(' ');
}

export default function DonutChart({
  slices,
  total,
}: {
  slices: AssetSlice[];
  total: number;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  const segments = useMemo<Segment[]>(() => {
    if (total <= 0) return [];

    const head = slices.slice(0, MAX_SLICES);
    const tail = slices.slice(MAX_SLICES);

    const result: Segment[] = head.map((s, i) => ({
      key: s.key,
      label: s.label,
      sublabel: s.sublabel,
      value: s.valueTwd,
      percent: (s.valueTwd / total) * 100,
      color: SERIES[i],
    }));

    if (tail.length > 0) {
      const tailTotal = tail.reduce((sum, s) => sum + s.valueTwd, 0);
      result.push({
        key: '__other__',
        label: '其他',
        sublabel: `${tail.length} 項`,
        value: tailTotal,
        percent: (tailTotal / total) * 100,
        color: OTHER_COLOR,
      });
    }
    return result;
  }, [slices, total]);

  const geometry = useMemo(() => {
    let cursor = 0;
    return segments.map((seg) => {
      const sweep = (seg.value / total) * Math.PI * 2;
      const start = cursor;
      const end = cursor + sweep;
      cursor = end;

      // 太小的切片留不出間隙,就整片畫滿
      const usable = sweep > GAP_RAD * 1.5;
      const s = usable ? start + GAP_RAD / 2 : start;
      const e = usable ? end - GAP_RAD / 2 : end;
      const centroid = polar((start + end) / 2, MID_R);

      return { seg, path: arcPath(s, e), centroid };
    });
  }, [segments, total]);

  if (segments.length === 0) {
    return (
      <div className="card-flush card-pad">
        <h2 className="section-title">資產配置</h2>
        <p className="mb-6 mt-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          還沒有資產資料。先到「帳戶」新增銀行帳戶,或到「股票」輸入期初持股。
        </p>
      </div>
    );
  }

  const active = segments.find((s) => s.key === activeKey) ?? null;
  const activeGeo = geometry.find((g) => g.seg.key === activeKey) ?? null;

  return (
    <div className="card-flush card-pad">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="section-title">資產配置</h2>
          <p className="eyebrow mt-0.5">各檔股票市值與各帳戶餘額佔比</p>
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="btn btn-ghost shrink-0 text-xs"
        >
          {showTable ? '看圖表' : '看表格'}
        </button>
      </div>

      {showTable ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm tnum">
            <thead>
              <tr className="eyebrow">
                <th className="pb-2 text-left font-normal">項目</th>
                <th className="pb-2 text-right font-normal">金額</th>
                <th className="pb-2 text-right font-normal">佔比</th>
              </tr>
            </thead>
            <tbody>
              {slices.map((s) => (
                <tr key={s.key} style={{ borderTop: '1px solid var(--divider)' }}>
                  <td className="py-2 pr-2">
                    <div className="truncate">{s.label}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {s.sublabel}
                    </div>
                  </td>
                  <td className="py-2 text-right">{formatMoney(s.valueTwd)}</td>
                  <td className="py-2 pl-2 text-right" style={{ color: 'var(--text-secondary)' }}>
                    {((s.valueTwd / total) * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-3 flex flex-col items-center gap-5 md:flex-row md:items-center md:gap-7">
          <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
            <svg
              width={SIZE}
              height={SIZE}
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              role="img"
              aria-label="資產配置圓餅圖"
            >
              {geometry.map(({ seg, path }) => (
                <path
                  key={seg.key}
                  d={path}
                  fill={seg.color}
                  tabIndex={0}
                  role="button"
                  aria-label={`${seg.label} ${formatMoney(seg.value)},佔 ${seg.percent.toFixed(1)}%`}
                  style={{
                    cursor: 'pointer',
                    outline: 'none',
                    opacity: activeKey && activeKey !== seg.key ? 0.35 : 1,
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={() => setActiveKey(seg.key)}
                  onMouseLeave={() => setActiveKey(null)}
                  onFocus={() => setActiveKey(seg.key)}
                  onBlur={() => setActiveKey(null)}
                  onTouchStart={() => setActiveKey(seg.key)}
                />
              ))}

              {/* 中心讀數 — 中空區只有 126px 寬,金額一律用壓縮寫法 */}
              <text
                x={CENTER}
                y={CENTER - 6}
                textAnchor="middle"
                fontSize="11"
                fill="var(--text-muted)"
              >
                {active ? active.label : '總資產'}
              </text>
              <text
                x={CENTER}
                y={CENTER + 15}
                textAnchor="middle"
                fontSize="18"
                fontWeight="600"
                fill="var(--text-primary)"
              >
                {active ? `${active.percent.toFixed(1)}%` : `NT$${formatCompact(total)}`}
              </text>
            </svg>

            {/* 浮動提示 */}
            {active && activeGeo && (
              <div
                className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs"
                style={{
                  left: `${(activeGeo.centroid.x / SIZE) * 100}%`,
                  top: `${(activeGeo.centroid.y / SIZE) * 100}%`,
                  transform: 'translate(-50%, -145%)',
                  background: 'var(--surface-1)',
                  border: '1px solid var(--hairline-ring)',
                  boxShadow: 'var(--shadow-raised)',
                  color: 'var(--text-primary)',
                }}
              >
                <span className="font-medium">{active.label}</span>
                <span className="tnum ml-2">{formatMoney(active.value)}</span>
              </div>
            )}
          </div>

          {/* 圖例 — 兩個以上系列一律附圖例,識別不靠顏色記憶 */}
          <ul className="w-full min-w-0 flex-1 space-y-0.5">
            {segments.map((seg) => (
              <li
                key={seg.key}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors"
                style={{
                  background: activeKey === seg.key ? 'var(--surface-sunken)' : 'transparent',
                }}
                onMouseEnter={() => setActiveKey(seg.key)}
                onMouseLeave={() => setActiveKey(null)}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: seg.color }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">
                  {seg.label}
                  <span className="ml-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {seg.sublabel}
                  </span>
                </span>
                <span
                  className="tnum shrink-0 text-xs"
                  style={{ color: 'var(--text-secondary)', minWidth: '2.7rem', textAlign: 'right' }}
                >
                  {seg.percent.toFixed(1)}%
                </span>
                <span className="tnum shrink-0 text-right text-xs" style={{ minWidth: '5.3rem' }}>
                  {formatMoney(seg.value)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
