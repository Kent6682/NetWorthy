'use client';

import { useLayoutEffect, useRef } from 'react';
import { formatNumberInput } from '@/lib/format';

/**
 * 邊打邊加千分位的數字輸入框。
 *
 * 用 type="text" 而不是 type="number" —— 後者不能顯示逗號。
 * 送出的值帶著逗號,server action 那邊用 parseNumberInput() 拿掉。
 *
 * 插入逗號會讓游標跳到最後面,所以記下「游標前面有幾個數字」,
 * 格式化之後再把游標放回同樣數量的數字後面。
 */
export default function NumberInput({
  value,
  onChange,
  maxDecimals = 4,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onChange: (value: string) => void;
  maxDecimals?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const caretDigits = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const target = caretDigits.current;
    if (!el || target === null || document.activeElement !== el) return;
    caretDigits.current = null;

    let seen = 0;
    let pos = 0;
    while (pos < value.length && seen < target) {
      if (/[\d.]/.test(value[pos])) seen += 1;
      pos += 1;
    }
    el.setSelectionRange(pos, pos);
  }, [value]);

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      onChange={(e) => {
        const raw = e.target.value;
        const caret = e.target.selectionStart ?? raw.length;
        caretDigits.current = raw.slice(0, caret).replace(/[^\d.]/g, '').length;
        onChange(formatNumberInput(raw, maxDecimals));
      }}
    />
  );
}
