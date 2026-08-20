import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/queries';
import InviteCode from '@/components/InviteCode';

export const dynamic = 'force-dynamic';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </dt>
      <dd className="min-w-0 truncate text-right text-sm">{value}</dd>
    </div>
  );
}

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) return null;

  const supabase = await createClient();
  const { data: household } = await supabase
    .from('households')
    .select('id, name')
    .eq('id', session.profile.household_id!)
    .maybeSingle();

  const { data: lastFx } = await supabase
    .from('latest_fx_rates')
    .select('rate, rate_date')
    .eq('from_currency', 'USD')
    .eq('to_currency', 'TWD')
    .maybeSingle();

  const { data: lastPrice } = await supabase
    .from('stock_price_history')
    .select('price_date')
    .order('price_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-lg font-semibold tracking-tight">設定</h1>

      <section className="card-flush card-pad">
        <h2 className="section-title">家庭</h2>
        <dl className="mt-2">
          <Row label="家庭名稱" value={household?.name ?? '—'} />
          <Row label="成員" value={session.members.map((m) => m.display_name).join('、')} />
        </dl>

        <div className="mt-4">
          <p className="label">邀請碼</p>
          <p className="mb-2 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            把這串代碼給家人,他們註冊後在「加入既有家庭」貼上就能一起記帳。
          </p>
          <InviteCode code={session.profile.household_id ?? ''} />
        </div>
      </section>

      <section className="card-flush card-pad mt-4 sm:mt-5">
        <h2 className="section-title">資料同步狀態</h2>
        <dl className="mt-2">
          <Row
            label="最新股價日期"
            value={<span className="tnum">{lastPrice?.price_date ?? '尚未同步'}</span>}
          />
          <Row
            label="最新匯率"
            value={
              <span className="tnum">
                {lastFx
                  ? `1 USD = ${Number(lastFx.rate).toFixed(3)} TWD(${lastFx.rate_date})`
                  : '尚未同步'}
              </span>
            }
          />
        </dl>
        <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          股價與匯率由 GitHub Actions 每天自動抓取。如果這裡長時間沒更新,
          到 GitHub repo 的 Actions 分頁看排程有沒有失敗。
        </p>
      </section>

      <section className="card-flush card-pad mt-4 sm:mt-5">
        <h2 className="section-title">帳號</h2>
        <dl className="mt-2">
          <Row label="顯示名稱" value={session.profile.display_name} />
          <Row label="Email" value={session.email} />
        </dl>
      </section>
    </div>
  );
}
