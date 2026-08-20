import Link from 'next/link';
import { Suspense } from 'react';
import AccountForm from '@/components/AccountForm';
import FilterBar from '@/components/FilterBar';
import TransferForm from '@/components/TransferForm';
import { EmptyState, SectionHeader } from '@/components/ListRow';
import { formatDate, formatMoney } from '@/lib/format';
import { toTwd } from '@/lib/portfolio';
import {
  getAccountBalances,
  getSession,
  getUsdToTwd,
  ownerIdsForScope,
  parseScope,
} from '@/lib/queries';
import { ACCOUNT_TYPE_LABEL, type AccountBalance } from '@/lib/types';

export const dynamic = 'force-dynamic';

function AccountGroup({
  title,
  hint,
  accounts,
  usdToTwd,
  memberNames,
  showOwner,
  currentUserId,
}: {
  title: string;
  hint: string;
  accounts: AccountBalance[];
  usdToTwd: number;
  memberNames: Map<string, string>;
  showOwner: boolean;
  currentUserId: string;
}) {
  const total = accounts.reduce(
    (sum, a) => sum + toTwd(Number(a.balance), a.currency, usdToTwd),
    0
  );

  return (
    <section className="card-flush overflow-hidden">
      <SectionHeader
        title={title}
        hint={hint}
        trailing={<span className="tnum text-sm font-medium">{formatMoney(total)}</span>}
      />

      {accounts.length === 0 ? (
        <EmptyState>還沒有這類帳戶。</EmptyState>
      ) : (
        <ul className="divide-hairline mt-3" style={{ borderTop: '1px solid var(--divider)' }}>
          {accounts.map((a) => (
            <li key={a.account_id}>
              <Link
                href={`/accounts/${a.account_id}`}
                className="flex items-center gap-3 px-4 py-3.5 transition-colors sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {a.institution}
                    {a.nickname && (
                      <span
                        className="ml-1.5 font-normal"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {a.nickname}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                    {a.currency}
                    {showOwner && ` ・ ${memberNames.get(a.owner_id) ?? ''}`}
                    {a.owner_id !== currentUserId && ' ・ 唯讀'}
                    {a.last_transaction_date && ` ・ ${formatDate(a.last_transaction_date)}`}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="tnum text-sm font-medium">
                    {formatMoney(Number(a.balance), a.currency)}
                  </div>
                  {a.currency === 'USD' && (
                    <div className="tnum text-xs" style={{ color: 'var(--text-muted)' }}>
                      ≈ {formatMoney(toTwd(Number(a.balance), 'USD', usdToTwd))}
                    </div>
                  )}
                </div>

                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--text-muted)"
                  strokeWidth="2"
                  className="shrink-0"
                  aria-hidden
                >
                  <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const params = await searchParams;
  const scope = parseScope(params.scope);

  const session = await getSession();
  if (!session) return null;

  const ownerIds = ownerIdsForScope(scope, session.userId, session.members);
  const memberNames = new Map(session.members.map((m) => [m.id, m.display_name]));

  const [{ rate: usdToTwd }, balances] = await Promise.all([
    getUsdToTwd(),
    getAccountBalances(ownerIds),
  ]);

  const active = balances.filter((b) => !b.is_archived);
  const banks = active.filter((b) => b.type === 'bank');
  const brokers = active.filter((b) => b.type === 'broker_cash');
  const myAccounts = active.filter((b) => b.owner_id === session.userId);

  const total = active.reduce(
    (sum, a) => sum + toTwd(Number(a.balance), a.currency, usdToTwd),
    0
  );

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">帳戶</h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          現金合計 <span className="tnum">{formatMoney(total)}</span>
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <AccountForm />
        <TransferForm accounts={myAccounts} />
      </div>

      <Suspense fallback={<div className="mb-4 h-9" />}>
        <FilterBar scope={scope} showScopeToggle={session.members.length > 1} showRange={false} />
      </Suspense>

      <div className="space-y-4 sm:space-y-5">
        <AccountGroup
          title={ACCOUNT_TYPE_LABEL.bank}
          hint="薪轉戶、活存、外幣戶等"
          accounts={banks}
          usdToTwd={usdToTwd}
          memberNames={memberNames}
          showOwner={scope === 'family'}
          currentUserId={session.userId}
        />
        <AccountGroup
          title={ACCOUNT_TYPE_LABEL.broker_cash}
          hint="買賣股票的交割款會自動進出,不需手動維護"
          accounts={brokers}
          usdToTwd={usdToTwd}
          memberNames={memberNames}
          showOwner={scope === 'family'}
          currentUserId={session.userId}
        />
      </div>

      <p className="mt-4 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        餘額由每個帳戶的收支流水帳累加算出,沒有可以直接編輯的總額欄位。
        點進帳戶可以看完整流水帳並新增收支。
      </p>
    </div>
  );
}
