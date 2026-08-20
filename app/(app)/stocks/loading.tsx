import { FilterBarSkeleton, ListCardSkeleton } from '@/components/Skeleton';

/** 股票頁的骨架:持股清單 + 交易紀錄 */
export default function StocksLoading() {
  return (
    <div className="grid gap-4 pb-8">
      <FilterBarSkeleton />
      <ListCardSkeleton rows={5} />
      <ListCardSkeleton rows={4} />
    </div>
  );
}
