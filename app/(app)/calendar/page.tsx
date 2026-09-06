import { Suspense } from 'react';
import FilterBar from '@/components/FilterBar';
import PnlCalendar from '@/components/PnlCalendar';
import { todayInTaipei } from '@/lib/format';
import {
  computeDailyPnl,
  daysInMonth,
  groupTradesByDate,
  monthGrid,
  monthTotal,
  parseMonth,
  previousDay,
  type DailyPnl,
} from '@/lib/pnl';
import {
  getSession,
  getSnapshotRange,
  getStockTradesInRange,
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

  const [snapshots, trades] = await Promise.all([
    // 多要前一天,才算得出當月第一天的盈虧
    getSnapshotRange(scope, session.userId, previousDay(first), last),
    getStockTradesInRange(ownerIds, first, last),
  ]);

  // 盈虧看的是股票市值,不是總資產 —— 詳見 lib/pnl.ts 的說明
  const stockByDate = new Map(
    snapshots.map((s) => [s.snapshot_date, Number(s.stock_twd)])
  );

  const rows = computeDailyPnl(stockByDate, groupTradesByDate(trades), days);
  const byDate = new Map<string, DailyPnl>(rows.map((r) => [r.date, r]));

  return (
    <div className="pb-2">
      <div className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">每日盈虧</h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          扣掉買賣後的純市值變化
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
