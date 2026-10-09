// Card-shaped placeholders matching the video grid's columns — used by
// loading.tsx and as the feed's Suspense fallback.
export function VideoGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="rounded-[32px] bg-white shadow-lg overflow-hidden animate-pulse"
        >
          <div className="aspect-video bg-slate-100" />
          <div className="p-5 space-y-3">
            <div className="h-5 w-4/5 rounded bg-slate-100" />
            <div className="h-4 w-2/5 rounded bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  );
}
