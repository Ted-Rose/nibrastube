import { VideoGridSkeleton } from "@/components/video-grid-skeleton";

export default function KidsPortalLoading() {
  return (
    <div className="min-h-screen bg-[#F0F4FF]">
      <header className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/85 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-md sm:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-2 py-2 sm:gap-3">
            <div className="hidden h-7 w-28 rounded-lg bg-slate-100 animate-pulse md:block" />
            <div className="h-11 min-w-0 flex-1 rounded-full bg-slate-100 animate-pulse sm:h-14" />
            <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-2xl bg-slate-100 animate-pulse" />
            <div className="w-11 h-11 rounded-full bg-slate-100 animate-pulse" />
          </div>
          <div className="grid grid-cols-5 gap-0.5 pb-2 sm:flex sm:gap-2 sm:pb-3">
            {/* sm+ widths approximate the real content-width pills
                (icon + label in kids-view-tabs.tsx) */}
            {["sm:w-28", "sm:w-32", "sm:w-24", "sm:w-28", "sm:w-28"].map(
              (w, i) => (
                <div
                  key={i}
                  className={`h-[52px] sm:h-11 ${w} rounded-2xl sm:rounded-full bg-slate-100 animate-pulse`}
                />
              ),
            )}
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 mt-6 sm:mt-10">
        <div className="h-9 w-56 rounded-lg bg-slate-200/70 animate-pulse mb-8" />
        <VideoGridSkeleton />
      </main>
    </div>
  );
}
