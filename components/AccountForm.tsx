'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Sheet from '@/components/Sheet';
import { createAccount } from '@/app/actions/accounts';
import { todayInTaipei } from '@/lib/format';

export default function AccountForm() {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    createAccount,
    null as { error?: string; ok?: boolean } | null
  );

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
  }, [state]);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        新增帳戶
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="新增帳戶"
        footer={
          <button
            type="submit"
            form="account-form"
            className="btn btn-primary w-full"
            disabled={pending}
          >
            {pending ? '建立中…' : '建立帳戶'}
          </button>
        }
      >
        <form id="account-form" ref={formRef} action={formAction}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="type">
                帳戶類型
              </label>
              <select id="type" name="type" className="field" defaultValue="bank">
                <option value="bank">銀行</option>
                <option value="broker_cash">券商虛擬帳戶</option>
              </select>
            </div>

            <div>
              <label className="label" htmlFor="currency">
                幣別
              </label>
              <select id="currency" name="currency" className="field" defaultValue="TWD">
                <option value="TWD">新台幣</option>
                <option value="USD">美元</option>
              </select>
            </div>

            <div>
              <label className="label" htmlFor="institution">
                機構名稱
              </label>
              <input
                id="institution"
                name="institution"
                className="field"
                placeholder="例如:國泰世華、元大證券"
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="nickname">
                備註(選填)
              </label>
              <input id="nickname" name="nickname" className="field" placeholder="例如:薪轉戶" />
            </div>

            <div>
              <label className="label" htmlFor="initial_balance">
                期初餘額
              </label>
              <input
                id="initial_balance"
                name="initial_balance"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                className="field"
                defaultValue={0}
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="opened_on">
                期初日期
              </label>
              <input
                id="opened_on"
                name="opened_on"
                type="date"
                className="field"
                defaultValue={todayInTaipei()}
                required
              />
            </div>
          </div>

          <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            期初餘額只需要輸入這一次。之後的變動一律用「存入」與「提出」記錄,不再直接改總額 —
            這樣才留得住完整的資金軌跡。
          </p>

          {state?.error && <p className="neg mt-3 text-sm leading-relaxed">{state.error}</p>}
        </form>
      </Sheet>
    </>
  );
}
