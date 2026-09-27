'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';

/**
 * 兩段式刪除:第一下只是展開確認,第二下才真的刪。
 *
 * 手機上列表很密,一按就刪太容易誤觸,而刪掉的交易救不回來。
 * 不用 window.confirm() —— 它在部分瀏覽器與 App 內建瀏覽器裡會被擋掉或長得很突兀。
 */
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="error-text min-h-[32px] px-1 text-xs font-medium underline underline-offset-2"
    >
      {pending ? '刪除中…' : '確定刪除'}
    </button>
  );
}

export default function ConfirmDelete({
  action,
  fields,
  what,
}: {
  action: (formData: FormData) => Promise<void>;
  /** 送給 server action 的隱藏欄位 */
  fields: Record<string, string>;
  /** 要刪的是什麼,顯示在確認文字裡,例如「這筆買進」 */
  what: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="min-h-[32px] px-1 text-xs underline underline-offset-2"
        style={{ color: 'var(--text-muted)' }}
      >
        刪除
      </button>
    );
  }

  return (
    <form action={action} className="inline-flex items-center gap-1.5" role="group" aria-label={`確認刪除${what}`}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        刪除{what}?
      </span>
      <SubmitButton />
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="min-h-[32px] px-1 text-xs underline underline-offset-2"
        style={{ color: 'var(--text-muted)' }}
        autoFocus
      >
        取消
      </button>
    </form>
  );
}
