import { Suspense } from 'react';
import FilterBar from '@/components/FilterBar';
import PnlCalendar from '@/components/PnlCalendar';
import { todayInTaipei } from '@/lib/format';
import {
  computeDailyPnl,
  daysInMonth,
  monthGrid,
  monthTotal,
  parseMonth,
  previousDay,
  type DailyPnl,
} from '@/lib/pnl';
import {
  getExternalFlows,
  getSession,
  getSnapshotRange,
  ownerIdsForScope,
  parseScope,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; scope?: string }>;
}) {
  const params = await searchParams;
  const scope = parseScope(params.scope);

  const session = await getSession();
  if (!session) return null;

  const today = todayInTaipei();
  const month = parseMonth(params.month, today.slice(0, 7));
  const ownerIds = ownerIdsForScope(scope, session.userId, session.members);

  const days = daysInMonth(month);
  const first = days[0];
  const last = days[days.length - 1];

  const [snapshots, flows] = await Promise.all([
    // 多要前一天,才算得出當月第一天的盈虧
    getSnapshotRange(scope, session.userId, previousDay(first), last),
    getExternalFlows(ownerIds, first, last),
  ]);

  const totalsByDate = new Map(
    snapshots.map((s) => [s.snapshot_date, Number(s.total_twd)])
  );

  const rows = computeDailyPnl(totalsByDate, flows, days);
  const byDate = new Map<string, DailyPnl>(rows.map((r) => [r.date, r]));

  return (
    <div className="pb-2">
      <div className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">每日盈虧</h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          扣掉資金進出後的純市值變化
        </p>
      </div>

      <Suspense fallback={<div className="mb-4 h-9" />}>
        <FilterBar scope={scope} showScopeToggle={session.members.length > 1} showRange={false} />
      </Suspense>

      <PnlCalendar
        month={month}
        weeks={monthGrid(month)}
        byDate={byDate}
        today={today}
        scope={scope}
        total={monthTotal(rows)}
      />
    </div>
  );
}
