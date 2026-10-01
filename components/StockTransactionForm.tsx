'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import NumberInput from '@/components/NumberInput';
import Sheet from '@/components/Sheet';
import { addStockTransaction, updateStockTransaction } from '@/app/actions/stocks';
import { estimateDividendDeduction, estimateTwFee } from '@/lib/fees';
import { formatNumber, formatNumberInput, parseNumberInput, todayInTaipei } from '@/lib/format';
import type { StockTxnType } from '@/lib/holdings';
import type { AccountBalance } from '@/lib/types';

interface Suggestion {
  symbol: string;
  name: string;
}

const TYPES: { key: StockTxnType; label: string; hint: string }[] = [
  { key: 'buy', label: '買進', hint: '會從券商帳戶扣款(股數 × 價格 + 手續費)' },
  { key: 'sell', label: '賣出', hint: '會存回券商帳戶(股數 × 價格 − 手續費與稅)' },
  {
    key: 'dividend',
    label: '現金股利',
    hint: '股數填除息日前一天收盤時的持股。盈虧算在除息日;有連動的話,錢在發放日存入券商帳戶',
  },
  {
    key: 'stock_dividend',
    label: '配股',
    hint: '股數填配到幾股(例如每千股配 50 股、持有 23,100 股 → 1,155 股)。總成本不變,均價會下降',
  },
  {
    key: 'initial',
    label: '期初持股',
    hint: '導入既有持股用:直接填目前的股數與均價,不會連動帳戶餘額',
  },
];

/** 每種類型的欄位名稱 */
const FIELD_LABELS: Record<StockTxnType, { shares: string; price: string; fee: string; date: string }> = {
  buy: { shares: '股數', price: '成交價', fee: '手續費與稅', date: '交易日期' },
  sell: { shares: '股數', price: '成交價', fee: '手續費與稅', date: '交易日期' },
  dividend: { shares: '除息日持股', price: '每股配息', fee: '扣款(二代健保等)', date: '除息日' },
  stock_dividend: { shares: '配到的股數', price: '', fee: '', date: '除權日' },
  initial: { shares: '股數', price: '目前均價', fee: '', date: '導入日期' },
};

/** 編輯模式要帶進來的那一筆 */
export interface EditingStockTxn {
  id: string;
  market: 'TW' | 'US';
  symbol: string;
  name: string | null;
  type: StockTxnType;
  shares: number;
  price: number;
  fee: number;
  transaction_date: string;
  pay_date: string | null;
  account_id: string | null;
}

/** 預先填好的新交易(例如「待確認配息」卡片按「記錄」) */
export type PresetStockTxn = Omit<EditingStockTxn, 'id' | 'account_id'>;

/**
 * 新增與編輯共用同一份表單。
 *
 * - `editing`:編輯模式。觸發按鈕是列表上的「編輯」小字,送出改呼叫 updateStockTransaction。
 * - `preset`:新增,但欄位先填好。觸發按鈕的文字用 `triggerLabel`。
 *
 * 兩種模式的費用都視為「使用者填過的」,不會被自動估算蓋掉。
 */
export default function StockTransactionForm({
  brokerAccounts,
  editing,
  preset,
  triggerLabel,
}: {
  brokerAccounts: AccountBalance[];
  editing?: EditingStockTxn;
  preset?: PresetStockTxn;
  triggerLabel?: string;
}) {
  const source = editing ?? preset;
  // 沒有券商帳戶時預設不勾連動,不然一打開就是一行錯誤訊息
  const defaultLink = editing ? editing.account_id !== null : brokerAccounts.length > 0;

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<StockTxnType>(source?.type ?? 'buy');
  const [linkAccount, setLinkAccount] = useState(defaultLink);
  const formRef = useRef<HTMLFormElement>(null);

  // 代號與名稱改成受控,才有辦法在選了建議之後把名稱自動帶進去
  const [market, setMarket] = useState<'TW' | 'US'>(source?.market ?? 'TW');
  const [symbol, setSymbol] = useState(source?.symbol ?? '');
  const [name, setName] = useState(source?.name ?? '');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  // 費用要跟著股數、價格、代號、日期自動算,所以這幾個也改成受控
  const [shares, setShares] = useState(source ? formatNumberInput(String(source.shares)) : '');
  const [price, setPrice] = useState(source ? String(source.price) : '');
  const [date, setDate] = useState(source?.transaction_date ?? todayInTaipei());
  const [payDate, setPayDate] = useState(source?.pay_date ?? '');
  const [fee, setFee] = useState(source ? formatNumberInput(String(source.fee), 2) : '');
  // 使用者自己改過費用之後就不再自動覆蓋,直到按「改回自動計算」。
  // 編輯與預填時,原本的費用就是算好或填過的,一開始就視為改過
  const [feeEdited, setFeeEdited] = useState(source !== undefined);

  /** 編輯與預填模式每次打開都從原始資料重來,不留上次沒存的修改 */
  function openSheet() {
    if (source) {
      setType(source.type);
      setLinkAccount(defaultLink);
      setMarket(source.market);
      setSymbol(source.symbol);
      setName(source.name ?? '');
      setShares(formatNumberInput(String(source.shares)));
      setPrice(String(source.price));
      setDate(source.transaction_date);
      setPayDate(source.pay_date ?? '');
      setFee(formatNumberInput(String(source.fee), 2));
      setFeeEdited(true);
    }
    setOpen(true);
  }

  const labels = FIELD_LABELS[type];
  const hasPrice = type !== 'stock_dividend';
  const hasFee = type === 'buy' || type === 'sell' || type === 'dividend';
  const hasCash = type === 'buy' || type === 'sell' || type === 'dividend';

  // 買賣:台股手續費與證交稅;現金股利:二代健保(台股)或預扣稅(美股)
  const tradeEstimate =
    market === 'TW' && (type === 'buy' || type === 'sell')
      ? estimateTwFee(type, symbol, parseNumberInput(shares), parseNumberInput(price), date)
      : null;
  const dividendEstimate =
    type === 'dividend'
      ? estimateDividendDeduction(market, parseNumberInput(shares) * parseNumberInput(price))
      : null;
  const autoAmount = tradeEstimate?.total ?? dividendEstimate?.amount ?? null;
  const autoFee = autoAmount === null ? '' : formatNumberInput(String(autoAmount), 2);

  useEffect(() => {
    if (!feeEdited) setFee(autoFee);
  }, [autoFee, feeEdited]);

  const [state, formAction, pending] = useActionState(
    editing ? updateStockTransaction : addStockTransaction,
    null as { error?: string; ok?: boolean } | null
  );

  useEffect(() => {
    if (state?.ok && source) {
      setOpen(false);
      return;
    }
    if (state?.ok) {
      formRef.current?.reset();
      // reset() 清不掉受控欄位,自己來
      setSymbol('');
      setName('');
      setShares('');
      setPrice('');
      setFee('');
      setPayDate('');
      setFeeEdited(false);
      setDate(todayInTaipei());
      setSuggestions([]);
      setSuggestOpen(false);
      setOpen(false);
    }
    // source 在同一個元件的生命週期內不會變,只需要跟著 state 跑
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

  const formId = `stock-txn-form-${editing?.id ?? (preset ? `preset-${preset.symbol}-${preset.transaction_date}-${preset.type}` : 'new')}`;
  const activeType = TYPES.find((t) => t.key === type)!;

  /** 費用欄底下的說明:怎麼估的,或已經手動改過 */
  function feeHint() {
    if (feeEdited && autoFee !== '' && fee !== autoFee) {
      return (
        <>
          已手動修改 ·{' '}
          <button type="button" className="underline" onClick={() => setFeeEdited(false)}>
            改回自動計算 {autoFee}
          </button>
        </>
      );
    }
    if (tradeEstimate) {
      return type === 'buy' ? (
        <>手續費 0.1425%,未含券商折扣</>
      ) : (
        <>
          手續費 {formatNumber(tradeEstimate.fee)} ＋ 證交稅 {formatNumber(tradeEstimate.tax)}(
          {tradeEstimate.taxLabel})
        </>
      );
    }
    if (dividendEstimate) {
      return (
        <>
          {dividendEstimate.label};ETF 有一部分可免扣、匯費另計,請以入帳金額為準
        </>
      );
    }
    if (type === 'dividend') return <>填完股數與每股配息會自動估算</>;
    if (market === 'US') return <>美股各券商收費不同,請自行填寫</>;
    return null;
  }

  return (
    <>
      {editing ? (
        <button
          type="button"
          onClick={openSheet}
          className="min-h-[32px] px-1 text-xs underline underline-offset-2"
          style={{ color: 'var(--text-muted)' }}
        >
          編輯
        </button>
      ) : preset ? (
        <button type="button" className="btn btn-primary" onClick={openSheet}>
          {triggerLabel ?? '記錄'}
        </button>
      ) : (
        <button type="button" className="btn btn-primary" onClick={openSheet}>
          {triggerLabel ?? '新增交易'}
        </button>
      )}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? '編輯股票交易' : '新增股票交易'}
        footer={
          <button type="submit" form={formId} className="btn btn-primary w-full" disabled={pending}>
            {pending ? '儲存中…' : '儲存'}
          </button>
        }
      >
        <form id={formId} ref={formRef} action={formAction}>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          {/* 交易類型 */}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
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
                  aria-activedescendant={highlight >= 0 ? `symbol-option-${highlight}` : undefined}
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
                          <span className="min-w-0 truncate" style={{ color: 'var(--text-secondary)' }}>
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
                {labels.shares}
              </label>
              <NumberInput
                id="shares"
                name="shares"
                className="field tnum"
                maxDecimals={4}
                value={shares}
                onChange={setShares}
                required
              />
            </div>

            {hasPrice ? (
              <div>
                <label className="label" htmlFor="price">
                  {labels.price}
                </label>
                <input
                  id="price"
                  name="price"
                  type="number"
                  inputMode="decimal"
                  step="0.0001"
                  min="0"
                  className="field"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  required
                />
              </div>
            ) : (
              // 配股沒有價格,送 0 過去
              <input type="hidden" name="price" value="0" />
            )}

            {hasFee && (
              <div>
                <label className="label" htmlFor="fee">
                  {labels.fee}
                </label>
                <NumberInput
                  id="fee"
                  name="fee"
                  className="field tnum"
                  maxDecimals={2}
                  placeholder={
                    type === 'dividend' || market === 'TW' ? '填完上面的欄位會自動帶出' : '0'
                  }
                  value={fee}
                  onChange={(v) => {
                    setFee(v);
                    setFeeEdited(true);
                  }}
                />
                <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {feeHint()}
                </p>
              </div>
            )}

            <div>
              <label className="label" htmlFor="transaction_date">
                {labels.date}
              </label>
              <input
                id="transaction_date"
                name="transaction_date"
                type="date"
                className="field"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>

            {type === 'dividend' && (
              <div>
                <label className="label" htmlFor="pay_date">
                  發放日(選填)
                </label>
                <input
                  id="pay_date"
                  name="pay_date"
                  type="date"
                  className="field"
                  min={date}
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                />
                <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  錢入帳的那天。沒填的話,連動的券商帳戶會記在除息日
                </p>
              </div>
            )}
          </div>

          {/* 券商帳戶連動:期初持股與配股沒有現金進出 */}
          {hasCash && (
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
                  {type === 'dividend' ? '股利存入券商帳戶' : '同步更新券商帳戶餘額'}
                  <span
                    className="mt-0.5 block text-xs leading-relaxed"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    取消勾選的話,這筆不會影響任何帳戶餘額
                  </span>
                </span>
              </label>

              {linkAccount && (
                <div className="mt-3">
                  <label className="label" htmlFor="account_id">
                    {type === 'dividend' ? '入帳帳戶' : '交割帳戶'}
                  </label>
                  {brokerAccounts.length === 0 ? (
                    <p className="text-xs leading-relaxed error-text">
                      你還沒有券商虛擬帳戶。請先到「帳戶」頁新增一個,或取消上面的勾選。
                    </p>
                  ) : (
                    <select
                      id="account_id"
                      name="account_id"
                      className="field"
                      defaultValue={editing?.account_id ?? undefined}
                      required
                    >
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

          {editing && (
            <p className="mt-4 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              儲存後持股、均價、已實現損益與券商帳戶餘額會立刻重算。
              日曆也立刻更新;日期在昨天以前的話,趨勢圖會在下一次每日同步時重算。
            </p>
          )}

          {state?.error && <p className="error-text mt-3 text-sm leading-relaxed">{state.error}</p>}
        </form>
      </Sheet>
    </>
  );
}
