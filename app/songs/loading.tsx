import { VideoGridSkeleton } from "@/components/video-grid-skeleton";

// Hard-navigation fallback for /songs — mirrors the catalog header
// (brand, search bar, auth pills) and a 3-tab strip above the grid,
// same skeleton shapes as app/kids/[profileId]/loading.tsx.
export default function SongsLoading() {
  return (
    <div className="min-h-screen bg-[#F0F4FF]">
      <header className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/85 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-md sm:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-2 py-2 sm:gap-3">
            <div className="hidden h-7 w-28 rounded-lg bg-slate-100 animate-pulse md:block" />
            <div className="h-11 min-w-0 flex-1 rounded-full bg-slate-100 animate-pulse sm:h-14" />
            <div className="h-11 w-20 rounded-full bg-slate-100 animate-pulse" />
            <div className="h-11 w-28 rounded-full bg-slate-100 animate-pulse" />
          </div>
          <div className="grid grid-cols-3 gap-0.5 pb-2 sm:flex sm:gap-2 sm:pb-3">
            {/* sm+ widths approximate the real content-width pills
                (icons come from tabIcon in
                _components/view-config.tsx) */}
            {["sm:w-24", "sm:w-36", "sm:w-24"].map((w, i) => (
              <div
                key={i}
                className={`h-[52px] sm:h-11 ${w} rounded-2xl sm:rounded-full bg-slate-100 animate-pulse`}
              />
            ))}
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
