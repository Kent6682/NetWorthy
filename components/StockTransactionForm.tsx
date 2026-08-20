'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Sheet from '@/components/Sheet';
import { addStockTransaction } from '@/app/actions/stocks';
import { todayInTaipei } from '@/lib/format';
import type { AccountBalance } from '@/lib/types';

type StockTxnType = 'initial' | 'buy' | 'sell';

interface Suggestion {
  symbol: string;
  name: string;
}

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

  // 代號與名稱改成受控,才有辦法在選了建議之後把名稱自動帶進去
  const [market, setMarket] = useState<'TW' | 'US'>('TW');
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const [state, formAction, pending] = useActionState(
    addStockTransaction,
    null as { error?: string; ok?: boolean } | null
  );

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      // reset() 清不掉受控欄位,自己來
      setSymbol('');
      setName('');
      setSuggestions([]);
      setSuggestOpen(false);
      setOpen(false);
    }
  }, [state]);

  /*
   * 打代號時查全市場字典。150ms 的 debounce 讓連續輸入只送最後一次,
   * AbortController 取消上一次 —— 否則回應順序顛倒時會用舊結果蓋掉新的。
   * 目前只有台股有字典資料,選美股時不用白跑一趟。
   */
  useEffect(() => {
    const q = symbol.trim();
    if (!suggestOpen || market !== 'TW' || !q) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/symbols?market=TW&q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        setSuggestions(await res.json());
        setHighlight(-1);
      } catch {
        // 被取消或網路不通:自動完成失效而已,照樣可以手動輸入
      }
    }, 150);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [symbol, market, suggestOpen]);

  function pick(s: Suggestion) {
    setSymbol(s.symbol);
    setName(s.name);
    setSuggestOpen(false);
    setHighlight(-1);
  }

  const showSuggestions = suggestOpen && suggestions.length > 0;

  function onSymbolKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
    } else if (e.key === 'Enter' && highlight >= 0) {
      // 只有真的選中某一列才攔 Enter,不然會擋掉正常的送出
      e.preventDefault();
      pick(suggestions[highlight]);
    } else if (e.key === 'Escape') {
      setSuggestOpen(false);
    }
  }

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
              <select
                id="market"
                name="market"
                className="field"
                value={market}
                onChange={(e) => setMarket(e.target.value as 'TW' | 'US')}
              >
                <option value="TW">台股(新台幣)</option>
                <option value="US">美股(美元)</option>
              </select>
            </div>

            <div>
              <label className="label" htmlFor="symbol">
                股票代號
              </label>
              <div className="relative">
                <input
                  id="symbol"
                  name="symbol"
                  className="field"
                  placeholder="台股 2330 / 美股 AAPL"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  value={symbol}
                  onChange={(e) => {
                    setSymbol(e.target.value);
                    setSuggestOpen(true);
                  }}
                  onKeyDown={onSymbolKeyDown}
                  onBlur={() => setSuggestOpen(false)}
                  role="combobox"
                  aria-expanded={showSuggestions}
                  aria-controls="symbol-suggestions"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    highlight >= 0 ? `symbol-option-${highlight}` : undefined
                  }
                />

                {showSuggestions && (
                  <ul id="symbol-suggestions" role="listbox" className="suggest-list">
                    {suggestions.map((s, i) => (
                      <li
                        key={s.symbol}
                        id={`symbol-option-${i}`}
                        role="option"
                        aria-selected={i === highlight}
                      >
                        <button
                          type="button"
                          className="suggest-item"
                          data-active={i === highlight}
                          /* 先攔下 mousedown,不讓輸入框失焦把清單關掉 */
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pick(s)}
                        >
                          <span className="tnum shrink-0">{s.symbol}</span>
                          <span
                            className="min-w-0 truncate"
                            style={{ color: 'var(--text-secondary)' }}
                          >
                            {s.name}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="label" htmlFor="name">
                商品名稱(選填)
              </label>
              <input
                id="name"
                name="name"
                className="field"
                placeholder={market === 'TW' ? '選代號會自動帶入' : '例如:Apple Inc.'}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
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
