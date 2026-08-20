'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { addAccountTransaction } from '@/app/actions/accounts';
import { todayInTaipei } from '@/lib/format';

type TxnType = 'deposit' | 'withdraw' | 'adjustment';

const TYPES: { key: TxnType; label: string; hint: string }[] = [
  { key: 'deposit', label: '存入', hint: '薪資、利息、他人匯入等進帳' },
  { key: 'withdraw', label: '提出', hint: '提款、繳款、消費等出帳' },
  {
    key: 'adjustment',
    label: '對帳調整',
    hint: '帳面跟實際對不起來時補的差額。可以填負數,原有紀錄不會被更動 — 請在備註寫明原因',
  },
];

export default function AccountTransactionForm({ accountId }: { accountId: string }) {
  const [type, setType] = useState<TxnType>('deposit');
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    addAccountTransaction,
    null as { error?: string; ok?: boolean } | null
  );

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  const activeType = TYPES.find((t) => t.key === type)!;

  return (
    <form ref={formRef} action={formAction} className="card-flush card-pad">
      <h3 className="section-title mb-3">新增一筆收支</h3>
      <input type="hidden" name="account_id" value={accountId} />

      <div className="grid grid-cols-3 gap-2">
        {TYPES.map((t) => (
          <label
            key={t.key}
            className="cursor-pointer rounded-lg px-2 py-2.5 text-center text-sm transition-colors"
            style={{
              border: `1px solid ${type === t.key ? 'var(--text-primary)' : 'var(--baseline)'}`,
              background: type === t.key ? 'var(--surface-sunken)' : 'transparent',
              fontWeight: type === t.key ? 500 : 400,
            }}
          >
            <input
              type="radio"
              name="type"
              value={t.key}
              checked={type === t.key}
              onChange={() => setType(t.key)}
              className="sr-only"
            />
            {t.label}
          </label>
        ))}
      </div>
      <p className="mb-4 mt-2 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        {activeType.hint}
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="amount">
            金額
          </label>
          <input
            id="amount"
            name="amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            className="field"
            placeholder={type === 'adjustment' ? '可填負數' : ''}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="transaction_date">
            日期
          </label>
          <input
            id="transaction_date"
            name="transaction_date"
            type="date"
            className="field"
            defaultValue={todayInTaipei()}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="note">
            備註
          </label>
          <input
            id="note"
            name="note"
            className="field"
            placeholder={type === 'adjustment' ? '請寫明差額原因' : '例如:薪資'}
            required={type === 'adjustment'}
          />
        </div>
      </div>

      {state?.error && <p className="neg mt-3 text-sm leading-relaxed">{state.error}</p>}

      <button type="submit" className="btn btn-primary mt-4 w-full sm:w-auto" disabled={pending}>
        {pending ? '儲存中…' : '新增'}
      </button>
    </form>
  );
}
