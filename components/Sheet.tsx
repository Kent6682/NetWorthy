'use client';

import { useEffect, useRef } from 'react';

/**
 * 表單容器
 *   手機:從底部滑上來的面板,最高佔螢幕 92%,內容可捲動
 *   桌機:置中對話框
 *
 * 開啟時鎖住背景捲動,Esc 可關閉,焦點進入面板。
 * 樣式在 globals.css 的 .sheet-* 系列。
 */
export default function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="sheet-root" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />

      <div ref={panelRef} tabIndex={-1} className="sheet-panel">
        <div className="sheet-header">
          <span className="sheet-grabber" aria-hidden />
          <h3 className="text-sm font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="btn btn-ghost -mr-2 text-xs">
            取消
          </button>
        </div>

        <div className="sheet-body">{children}</div>

        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </div>
  );
}
