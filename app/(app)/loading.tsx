import { Bar, FilterBarSkeleton } from '@/components/Skeleton';

/** 首頁(總覽)的骨架:主數字 + 四個統計方塊 + 圓餅圖與趨勢圖 */
export default function DashboardLoading() {
  return (
    <div className="pb-8">
      <FilterBarSkeleton />

      <div className="mb-5">
        <Bar w="72px" h={12} />
        <Bar w="240px" h={38} className="mt-2.5" />
        <Bar w="150px" h={13} className="mt-2.5" />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card px-3.5 py-3 sm:px-4">
            <Bar w="60%" h={11} />
            <Bar w="80%" h={17} className="mt-2" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card card-pad">
          <Bar w="100px" h={13} />
          <Bar h={220} className="mt-4" />
        </div>
        <div className="card card-pad">
          <Bar w="100px" h={13} />
          <Bar h={220} className="mt-4" />
        </div>
      </div>
    </div>
  );
}
