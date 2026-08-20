import Link from 'next/link';
import { notFound } from 'next/navigation';
import AccountTransactionForm from '@/components/AccountTransactionForm';
import { EmptyState, ListRow, SectionHeader } from '@/components/ListRow';
import { deleteAccountTransaction } from '@/app/actions/accounts';
import { createClient } from '@/lib/supabase/server';
import { formatDate, formatMoney } from '@/lib/format';
import { getSession } from '@/lib/queries';
import {
  ACCOUNT_TXN_LABEL,
  type AccountBalance,
  type AccountTransaction,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return null;

  const supabase = await createClient();

  const { data: account } = await supabase
    .from('account_balances')
    .select('*')
    .eq('account_id', id)
    .maybeSingle<AccountBalance>();

  if (!account) notFound();

  const { data: rawTxns } = await supabase
    .from('account_transactions')
    .select('*')
    .eq('account_id', id)
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false });

  const transactions = (rawTxns ?? []) as AccountTransaction[];
  const isOwner = account.owner_id === session.userId;

  // 由舊到新累加,算出每一筆之後的結餘
  const runningBalances = new Map<string, number>();
  let running = 0;
  for (const t of [...transactions].reverse()) {
    running += Number(t.signed_amount);
    runningBalances.set(t.id, running);
  }

  function DeleteButton({ txnId }: { txnId: string }) {
    return (
      <form action={deleteAccountTransaction}>
        <input type="hidden" name="id" value={txnId} />
        <input type="hidden" name="account_id" value={id} />
        <button
          type="submit"
          className="text-xs underline underline-offset-2"
          style={{ color: 'var(--text-muted)' }}
        >
          刪除
        </button>
      </form>
    );
  }

  function signedAmount(t: AccountTransaction) {
    const signed = Number(t.signed_amount);
    return (
      <span className={signed >= 0 ? 'pos' : 'neg'}>
        {signed >= 0 ? '+' : '−'}
        {formatMoney(Math.abs(signed), account!.currency).replace('-', '')}
      </span>
    );
  }

  return (
    <div>
      <Link
        href="/accounts"
        className="inline-block text-xs"
        style={{ color: 'var(--text-secondary)' }}
      >
        ← 帳戶列表
      </Link>

      <div className="mb-5 mt-3">
        <h1 className="text-base font-semibold tracking-tight">
          {account.institution}
          {account.nickname && (
            <span className="ml-2 text-sm font-normal" style={{ color: 'var(--text-secondary)' }}>
              {account.nickname}
            </span>
          )}
        </h1>
        <p className="eyebrow mt-0.5">
          {account.type === 'bank' ? '銀行' : '券商虛擬帳戶'} ・ {account.currency}
          {!isOwner && ' ・ 家人的帳戶,唯讀'}
        </p>
        <p className="figure-lg tnum mt-3">
          {formatMoney(Number(account.balance), account.currency)}
        </p>
      </div>

      {isOwner && (
        <div className="mb-4 sm:mb-5">
          <AccountTransactionForm accountId={id} />
        </div>
      )}

      <section className="card-flush overflow-hidden">
        <SectionHeader title="收支流水帳" hint={`共 ${transactions.length} 筆`} />

        {transactions.length === 0 ? (
          <EmptyState>還沒有任何紀錄。</EmptyState>
        ) : (
          <>
            {/* 手機 */}
            <div
              className="divide-hairline mt-3 md:hidden"
              style={{ borderTop: '1px solid var(--divider)' }}
            >
              {transactions.map((t) => {
                const fromStock = t.stock_transaction_id !== null;
                return (
                  <ListRow
                    key={t.id}
                    title={ACCOUNT_TXN_LABEL[t.type]}
                    subtitle={t.note ?? undefined}
                    value={signedAmount(t)}
                    subValue={
                      <span style={{ color: 'var(--text-muted)' }}>
                        結餘 {formatMoney(runningBalances.get(t.id) ?? 0, account.currency)}
                      </span>
                    }
                    meta={
                      <>
                        {formatDate(t.transaction_date)}
                        {fromStock && ' ・ 股票交易自動連動'}
                      </>
                    }
                    action={
                      isOwner && !fromStock && t.type !== 'initial' ? (
                        <DeleteButton txnId={t.id} />
                      ) : undefined
                    }
                  />
                );
              })}
            </div>

            {/* 桌機 */}
            <div className="mt-3 hidden md:block">
              <table className="w-full text-sm tnum">
                <thead>
                  <tr className="eyebrow">
                    <th className="px-5 py-2 text-left font-normal">日期</th>
                    <th className="px-3 py-2 text-left font-normal">類型</th>
                    <th className="px-3 py-2 text-left font-normal">備註</th>
                    <th className="px-3 py-2 text-right font-normal">金額</th>
                    <th className="px-3 py-2 text-right font-normal">結餘</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => {
                    const fromStock = t.stock_transaction_id !== null;
                    return (
                      <tr key={t.id} style={{ borderTop: '1px solid var(--divider)' }}>
                        <td className="px-5 py-2.5">{formatDate(t.transaction_date)}</td>
                        <td className="px-3 py-2.5">{ACCOUNT_TXN_LABEL[t.type]}</td>
                        <td className="px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>
                          {t.note ?? '—'}
                          {fromStock && (
                            <span className="ml-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                              (股票交易自動連動)
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">{signedAmount(t)}</td>
                        <td
                          className="px-3 py-2.5 text-right"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {formatMoney(runningBalances.get(t.id) ?? 0, account.currency)}
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          {isOwner && !fromStock && t.type !== 'initial' && (
                            <DeleteButton txnId={t.id} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <p className="mt-4 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        期初餘額與股票連動產生的紀錄不能直接刪除:前者是這個帳戶的起算點,
        後者請回「股票」頁刪除原本那筆買賣,連動紀錄會一併移除。
        若帳面跟實際對不起來,請用「對帳調整」補一筆並寫明原因,不要去改動舊紀錄。
      </p>
    </div>
  );
}
