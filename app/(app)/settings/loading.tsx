import { Bar, ListCardSkeleton } from '@/components/Skeleton';

/** 設定頁的骨架:家庭資訊 + 同步狀態 */
export default function SettingsLoading() {
  return (
    <div className="grid gap-4 pb-8">
      <Bar w="96px" h={20} />
      <ListCardSkeleton rows={3} />
      <ListCardSkeleton rows={3} />
    </div>
  );
}
