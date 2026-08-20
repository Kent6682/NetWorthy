import type { ReactNode } from 'react';

/**
 * 手機版的資料列 — 桌機用表格,手機用這個卡片列。
 *
 * 版面:  標題              主要數值
 *        副標題            次要數值
 *        ─────────────────────────
 *        補充資訊 · 補充資訊     動作
 */
export function ListRow({
  title,
  subtitle,
  value,
  subValue,
  meta,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  value: ReactNode;
  subValue?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          {subtitle && (
            <div className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-muted)' }}>
              {subtitle}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="tnum text-sm font-medium">{value}</div>
          {subValue && <div className="tnum mt-0.5 text-xs">{subValue}</div>}
        </div>
      </div>

      {(meta || action) && (
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="min-w-0 truncate text-xs" style={{ color: 'var(--text-muted)' }}>
            {meta}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
    </div>
  );
}

/** 區塊標頭:標題在左,合計或動作在右 */
export function SectionHeader({
  title,
  hint,
  trailing,
}: {
  title: string;
  hint?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
      <div className="min-w-0">
        <h2 className="section-title">{title}</h2>
        {hint && (
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            {hint}
          </p>
        )}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  );
}

/** 空狀態 */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p
      className="px-4 pb-7 pt-6 text-sm leading-relaxed sm:px-5"
      style={{ color: 'var(--text-muted)' }}
    >
      {children}
    </p>
  );
}
