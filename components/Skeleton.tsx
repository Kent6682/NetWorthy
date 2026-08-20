/**
 * 換頁骨架的積木。
 *
 * 頁面全是 force-dynamic,點下分頁後在伺服器回應前畫面完全不動,
 * 各路由的 loading.tsx 用這幾塊拼出「正在載入」的形狀。
 * 樣式在 globals.css 的 .skeleton。
 */

export function Bar({
  w = '100%',
  h = 14,
  className = '',
}: {
  w?: string;
  h?: number;
  className?: string;
}) {
  return <div className={`skeleton ${className}`} style={{ width: w, height: h }} />;
}

/** 篩選列的位置,避免內容載入後整頁往下跳 */
export function FilterBarSkeleton() {
  return (
    <div className="mb-4 flex gap-2">
      <Bar w="88px" h={34} />
      <Bar w="88px" h={34} />
    </div>
  );
}

/** 列表卡片:一個標題列 + 數列資料 */
export function ListCardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <section className="card-flush overflow-hidden">
      <div className="px-3.5 py-3 sm:px-4">
        <Bar w="120px" h={13} />
      </div>
      <div className="divide-hairline">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 px-3.5 py-3.5 sm:px-4">
            <div className="min-w-0 flex-1">
              <Bar w="35%" h={14} />
              <Bar w="55%" h={11} className="mt-2" />
            </div>
            <Bar w="76px" h={14} />
          </div>
        ))}
      </div>
    </section>
  );
}
