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

// Shelf-shaped placeholder matching VideoShelf's heading + horizontal
// card row — the Suspense fallback for HomeShelves. The row is clipped
// (not scrollable) so the skeleton never overflows the page.
export function ShelfSkeleton() {
  return (
    <div className="animate-pulse">
      {[0, 1].map((shelf) => (
        <section key={shelf} className="mb-10" aria-hidden="true">
          <div className="mb-4 h-8 w-48 rounded-lg bg-white" />
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="w-[72vw] max-w-72 shrink-0 sm:w-72"
              >
                <div className="overflow-hidden rounded-[32px] bg-white shadow-lg">
                  <div className="aspect-video bg-slate-100" />
                  <div className="space-y-3 p-4">
                    <div className="h-5 w-4/5 rounded bg-slate-100" />
                    <div className="h-4 w-2/5 rounded bg-slate-100" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
