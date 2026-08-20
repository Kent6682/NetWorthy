import { FilterBarSkeleton, ListCardSkeleton } from '@/components/Skeleton';

/** 帳戶頁與單一帳戶流水帳共用的骨架 */
export default function AccountsLoading() {
  return (
    <div className="grid gap-4 pb-8">
      <FilterBarSkeleton />
      <ListCardSkeleton rows={3} />
      <ListCardSkeleton rows={3} />
    </div>
  );
}
