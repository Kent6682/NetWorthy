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

  /*
   * onClose 放進 ref,不要進 effect 的依賴。
   *
   * 呼叫端傳的都是行內箭頭函式(onClose={() => setOpen(false)}),每次 render
   * 都是新的識別。若把它列為依賴,表單裡任何一次 setState 都會讓下面的 effect
   * 重跑,而 effect 裡的 panelRef.focus() 會把焦點從使用者正在打字的輸入框搶走
   * —— 症狀是每打一個字就要重新點一次欄位。
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCloseRef.current();
    }
    document.addEventListener('keydown', onKeyDown);
    // 只在開啟的那一次把焦點移進面板
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

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
