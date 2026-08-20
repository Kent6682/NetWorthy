'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Sheet from '@/components/Sheet';
import { transferBetweenAccounts } from '@/app/actions/accounts';
import { todayInTaipei } from '@/lib/format';
import type { AccountBalance } from '@/lib/types';

export default function TransferForm({ accounts }: { accounts: AccountBalance[] }) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    transferBetweenAccounts,
    null as { error?: string; ok?: boolean } | null
  );

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
  }, [state]);

  if (accounts.length < 2) return null;

  const label = (a: AccountBalance) =>
    `${a.institution}${a.nickname ? `・${a.nickname}` : ''}(${a.currency})`;

  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        帳戶間轉帳
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="帳戶間轉帳"
        footer={
          <button
            type="submit"
            form="transfer-form"
            className="btn btn-primary w-full"
            disabled={pending}
          >
            {pending ? '處理中…' : '確認轉帳'}
          </button>
        }
      >
        <form id="transfer-form" ref={formRef} action={formAction}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="from_account_id">
                轉出帳戶
              </label>
              <select id="from_account_id" name="from_account_id" className="field" required>
                {accounts.map((a) => (
                  <option key={a.account_id} value={a.account_id}>
                    {label(a)}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="label" htmlFor="to_account_id">
                轉入帳戶
              </label>
              <select
                id="to_account_id"
                name="to_account_id"
                className="field"
                defaultValue={accounts[1]?.account_id}
                required
              >
                {accounts.map((a) => (
                  <option key={a.account_id} value={a.account_id}>
                    {label(a)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="transfer_amount">
                金額
              </label>
              <input
                id="transfer_amount"
                name="amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                className="field"
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="transfer_date">
                日期
              </label>
              <input
                id="transfer_date"
                name="transaction_date"
                type="date"
                className="field"
                defaultValue={todayInTaipei()}
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className="label" htmlFor="transfer_note">
                備註(選填)
              </label>
              <input
                id="transfer_note"
                name="note"
                className="field"
                placeholder="例如:轉入證券戶準備進場"
              />
            </div>
          </div>

          <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            轉帳會在兩個帳戶各記一筆(轉出 / 轉入),總資產不會因此變動。
            跨幣別轉帳請分別用「提出」與「存入」記錄實際金額。
          </p>

          {state?.error && <p className="neg mt-3 text-sm leading-relaxed">{state.error}</p>}
        </form>
      </Sheet>
    </>
  );
}
