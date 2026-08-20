'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Sheet from '@/components/Sheet';
import { addStockTransaction } from '@/app/actions/stocks';
import { todayInTaipei } from '@/lib/format';
import type { AccountBalance } from '@/lib/types';

type StockTxnType = 'initial' | 'buy' | 'sell';

const TYPES: { key: StockTxnType; label: string; hint: string }[] = [
  { key: 'buy', label: '買進', hint: '會從券商帳戶扣款(股數 × 價格 + 手續費)' },
  { key: 'sell', label: '賣出', hint: '會存回券商帳戶(股數 × 價格 − 手續費與稅)' },
  {
    key: 'initial',
    label: '期初持股',
    hint: '導入既有持股用:直接填目前的股數與均價,不會連動帳戶餘額',
  },
];

export default function StockTransactionForm({
  brokerAccounts,
}: {
  brokerAccounts: AccountBalance[];
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<StockTxnType>('buy');
  const [linkAccount, setLinkAccount] = useState(true);
  const formRef = useRef<HTMLFormElement>(null);

  const [state, formAction, pending] = useActionState(
    addStockTransaction,
    null as { error?: string; ok?: boolean } | null
  );

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
  }, [state]);

  const activeType = TYPES.find((t) => t.key === type)!;
  const isInitial = type === 'initial';

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        新增交易
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="新增股票交易"
        footer={
          <button
            type="submit"
            form="stock-txn-form"
            className="btn btn-primary w-full"
            disabled={pending}
          >
            {pending ? '儲存中…' : '儲存'}
          </button>
        }
      >
        <form id="stock-txn-form" ref={formRef} action={formAction}>
          {/* 交易類型 */}
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="market">
                市場
              </label>
              <select id="market" name="market" className="field" defaultValue="TW">
                <option value="TW">台股(新台幣)</option>
                <option value="US">美股(美元)</option>
              </select>
            </div>

            <div>
              <label className="label" htmlFor="symbol">
                股票代號
              </label>
              <input
                id="symbol"
                name="symbol"
                className="field"
                placeholder="台股 2330 / 美股 AAPL"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className="label" htmlFor="name">
                公司名稱(選填)
              </label>
              <input id="name" name="name" className="field" placeholder="例如:台積電" />
            </div>

            <div>
              <label className="label" htmlFor="shares">
                股數
              </label>
              <input
                id="shares"
                name="shares"
                type="number"
                inputMode="decimal"
                step="0.0001"
                min="0.0001"
                className="field"
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="price">
                {isInitial ? '目前均價' : '成交價'}
              </label>
              <input
                id="price"
                name="price"
                type="number"
                inputMode="decimal"
                step="0.0001"
                min="0"
                className="field"
                required
              />
            </div>

            {!isInitial && (
              <div>
                <label className="label" htmlFor="fee">
                  手續費與稅
                </label>
                <input
                  id="fee"
                  name="fee"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  className="field"
                  defaultValue={0}
                />
              </div>
            )}

            <div>
              <label className="label" htmlFor="transaction_date">
                {isInitial ? '導入日期' : '交易日期'}
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
          </div>

          {/* 券商帳戶連動 */}
          {!isInitial && (
            <div className="mt-4 rounded-lg p-3" style={{ background: 'var(--surface-sunken)' }}>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name="link_account"
                  checked={linkAccount}
                  onChange={(e) => setLinkAccount(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>
                  同步更新券商帳戶餘額
                  <span
                    className="mt-0.5 block text-xs leading-relaxed"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    取消勾選的話,這筆交易不會影響任何帳戶餘額
                  </span>
                </span>
              </label>

              {linkAccount && (
                <div className="mt-3">
                  <label className="label" htmlFor="account_id">
                    交割帳戶
                  </label>
                  {brokerAccounts.length === 0 ? (
                    <p className="text-xs leading-relaxed neg">
                      你還沒有券商虛擬帳戶。請先到「帳戶」頁新增一個,或取消上面的勾選。
                    </p>
                  ) : (
                    <select id="account_id" name="account_id" className="field" required>
                      {brokerAccounts.map((a) => (
                        <option key={a.account_id} value={a.account_id}>
                          {a.institution}
                          {a.nickname ? `・${a.nickname}` : ''}({a.currency})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          )}

          {state?.error && (
            <p className="neg mt-3 text-sm leading-relaxed">{state.error}</p>
          )}
        </form>
      </Sheet>
    </>
  );
}
