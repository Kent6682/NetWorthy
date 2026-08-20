'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatCompact, formatDate, formatMoney } from '@/lib/format';
import type { NetWorthSnapshot } from '@/lib/types';

/**
 * 資產增長曲線
 *
 * 設計規則:
 *   - 單一系列 → 不放圖例(標題已經說明畫的是什麼),端點直接標值
 *   - 2px 線、圓角接點;端點標記 ≥8px 並帶 2px 底色外環
 *   - 格線為 1px 實線,絕不用虛線
 *   - 容器高度含 x 軸文字帶,不會擠出內部捲軸
 *   - 邊距與刻度數量隨螢幕寬度調整,窄螢幕不會被軸標籤吃掉繪圖區
 *   - 觸控與滑鼠都能取值(touchmove / mousemove),另備表格檢視
 */

/** 依容器寬度決定繪圖區的邊距與刻度密度 */
function layoutFor(width: number) {
  const narrow = width < 480;
  return {
    pad: {
      top: 14,
      right: narrow ? 46 : 72,
      bottom: narrow ? 24 : 28,
      left: narrow ? 42 : 56,
    },
    plotHeight: narrow ? 168 : 220,
    tickCount: narrow ? 3 : 4,
    fontSize: narrow ? 10 : 11,
  };
}

/** 產生好看的整數刻度 */
function niceTicks(min: number, max: number, count: number): number[] {
  if (max === min) {
    const pad = Math.abs(max) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const rawStep = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(v);
  return ticks;
}

export default function TrendChart({
  data,
  rangeLabel,
}: {
  data: NetWorthSnapshot[];
  rangeLabel: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(680);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  // 用實際像素寬度渲染,線寬與標記尺寸才會精準
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setWidth(Math.max(260, entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const L = layoutFor(width);
  const height = L.plotHeight + L.pad.top + L.pad.bottom;
  const plotWidth = Math.max(40, width - L.pad.left - L.pad.right);

  const model = useMemo(() => {
    if (data.length === 0) return null;

    const values = data.map((d) => Number(d.total_twd));
    const ticks = niceTicks(Math.min(...values), Math.max(...values), L.tickCount);
    const yMin = Math.min(ticks[0], ...values);
    const yMax = Math.max(ticks[ticks.length - 1], ...values);

    const x = (i: number) =>
      L.pad.left + (data.length === 1 ? plotWidth / 2 : (i / (data.length - 1)) * plotWidth);
    const y = (v: number) =>
      L.pad.top + L.plotHeight - ((v - yMin) / (yMax - yMin || 1)) * L.plotHeight;

    const points = values.map((v, i) => ({ x: x(i), y: y(v), value: v }));
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const baselineY = L.pad.top + L.plotHeight;
    const area =
      `${line} L ${points[points.length - 1].x} ${baselineY} L ${points[0].x} ${baselineY} Z`;

    return { points, line, area, ticks, y, first: values[0], last: values[values.length - 1] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, plotWidth, L.pad.left, L.pad.top, L.plotHeight, L.tickCount]);

  /** 滑鼠與觸控共用:找最靠近的資料點,不需要精準命中 */
  function pickNearest(clientX: number, rect: DOMRect) {
    if (!model) return;
    const px = clientX - rect.left;
    let nearest = 0;
    let best = Infinity;
    model.points.forEach((p, i) => {
      const d = Math.abs(p.x - px);
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    setHoverIndex(nearest);
  }

  const change = model ? model.last - model.first : 0;
  const changePercent = model && model.first !== 0 ? (change / Math.abs(model.first)) * 100 : 0;

  return (
    <div className="card-flush card-pad">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h2 className="section-title">總資產增長</h2>
          <p className="eyebrow mt-0.5">{rangeLabel}的每日總資產(新台幣)</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {model && data.length > 1 && (
            <span className={`delta-chip ${change >= 0 ? 'pos' : 'neg'}`}>
              {change >= 0 ? '↑' : '↓'} {changePercent >= 0 ? '+' : ''}
              {changePercent.toFixed(1)}%
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            className="btn btn-ghost text-xs"
          >
            {showTable ? '看圖表' : '看表格'}
          </button>
        </div>
      </div>

      {data.length === 0 ? (
        <p className="py-14 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          還沒有歷史資料。每日同步排程跑過之後,這裡就會開始累積趨勢。
        </p>
      ) : showTable ? (
        <div className="mt-4 max-h-72 overflow-y-auto">
          <table className="w-full text-sm tnum">
            <thead className="sticky top-0" style={{ background: 'var(--surface-1)' }}>
              <tr className="eyebrow">
                <th className="pb-2 text-left font-normal">日期</th>
                <th className="hidden pb-2 text-right font-normal sm:table-cell">現金</th>
                <th className="hidden pb-2 text-right font-normal sm:table-cell">股票</th>
                <th className="pb-2 text-right font-normal">總資產</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.snapshot_date} style={{ borderTop: '1px solid var(--divider)' }}>
                  <td className="py-1.5">{formatDate(d.snapshot_date)}</td>
                  <td
                    className="hidden py-1.5 text-right sm:table-cell"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {formatMoney(Number(d.cash_twd))}
                  </td>
                  <td
                    className="hidden py-1.5 text-right sm:table-cell"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {formatMoney(Number(d.stock_twd))}
                  </td>
                  <td className="py-1.5 text-right">{formatMoney(Number(d.total_twd))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrapRef} className="relative mt-3 w-full">
          {model && (
            <svg
              width={width}
              height={height}
              onMouseMove={(e) => pickNearest(e.clientX, e.currentTarget.getBoundingClientRect())}
              onMouseLeave={() => setHoverIndex(null)}
              onTouchStart={(e) =>
                pickNearest(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())
              }
              onTouchMove={(e) =>
                pickNearest(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())
              }
              onTouchEnd={() => setHoverIndex(null)}
              role="img"
              aria-label={`總資產增長曲線,${rangeLabel}`}
              style={{ display: 'block', touchAction: 'pan-y' }}
            >
              {/* 格線與 y 軸刻度 */}
              {model.ticks.map((t) => (
                <g key={t}>
                  <line
                    x1={L.pad.left}
                    x2={width - L.pad.right}
                    y1={model.y(t)}
                    y2={model.y(t)}
                    stroke="var(--gridline)"
                    strokeWidth={1}
                  />
                  <text
                    x={L.pad.left - 8}
                    y={model.y(t) + 4}
                    textAnchor="end"
                    fontSize={L.fontSize}
                    fill="var(--text-muted)"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {formatCompact(t)}
                  </text>
                </g>
              ))}

              {/* 面積填色:系列色 10% 濃度的一層薄霧 */}
              <path d={model.area} fill="var(--series-1)" fillOpacity={0.1} />

              {/* 主線 */}
              <path
                d={model.line}
                fill="none"
                stroke="var(--series-1)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* 十字準星 */}
              {hoverIndex !== null && (
                <>
                  <line
                    x1={model.points[hoverIndex].x}
                    x2={model.points[hoverIndex].x}
                    y1={L.pad.top}
                    y2={L.pad.top + L.plotHeight}
                    stroke="var(--baseline)"
                    strokeWidth={1}
                  />
                  <circle
                    cx={model.points[hoverIndex].x}
                    cy={model.points[hoverIndex].y}
                    r={5}
                    fill="var(--series-1)"
                    stroke="var(--surface-1)"
                    strokeWidth={2}
                  />
                </>
              )}

              {/* 端點標記 + 直接標值 */}
              <circle
                cx={model.points[model.points.length - 1].x}
                cy={model.points[model.points.length - 1].y}
                r={4.5}
                fill="var(--series-1)"
                stroke="var(--surface-1)"
                strokeWidth={2}
              />
              <text
                x={model.points[model.points.length - 1].x + 9}
                y={model.points[model.points.length - 1].y + 4}
                fontSize={L.fontSize + 1}
                fontWeight="500"
                fill="var(--text-primary)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatCompact(model.last)}
              </text>

              {/* x 軸:只標頭尾,中間交給提示框 */}
              <line
                x1={L.pad.left}
                x2={width - L.pad.right}
                y1={L.pad.top + L.plotHeight}
                y2={L.pad.top + L.plotHeight}
                stroke="var(--baseline)"
                strokeWidth={1}
              />
              <text
                x={L.pad.left}
                y={height - 6}
                fontSize={L.fontSize}
                fill="var(--text-muted)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatDate(data[0].snapshot_date)}
              </text>
              <text
                x={width - L.pad.right}
                y={height - 6}
                textAnchor="end"
                fontSize={L.fontSize}
                fill="var(--text-muted)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatDate(data[data.length - 1].snapshot_date)}
              </text>
            </svg>
          )}

          {/* 提示框 */}
          {model && hoverIndex !== null && (
            <div
              className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg px-3 py-2 text-xs"
              style={{
                left: Math.min(Math.max(model.points[hoverIndex].x, 68), Math.max(68, width - 68)),
                top: 0,
                transform: 'translateX(-50%)',
                background: 'var(--surface-1)',
                border: '1px solid var(--hairline-ring)',
                boxShadow: 'var(--shadow-raised)',
              }}
            >
              <div style={{ color: 'var(--text-muted)' }}>
                {formatDate(data[hoverIndex].snapshot_date)}
              </div>
              <div className="tnum mt-0.5 font-medium">
                {formatMoney(Number(data[hoverIndex].total_twd))}
              </div>
              <div className="tnum mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                現金 {formatCompact(Number(data[hoverIndex].cash_twd))}・股票{' '}
                {formatCompact(Number(data[hoverIndex].stock_twd))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
