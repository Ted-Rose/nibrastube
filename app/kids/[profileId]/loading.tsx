import { VideoGridSkeleton } from "@/components/video-grid-skeleton";

export default function KidsPortalLoading() {
  return (
    <div className="min-h-screen bg-[#F0F4FF]">
      <header className="sticky top-0 z-10 border-b-4 border-slate-100 bg-white px-4 sm:px-6 pt-[max(1rem,env(safe-area-inset-top))] pb-3 sm:pb-4 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="w-10 h-10 rounded-full bg-slate-100 animate-pulse" />
          <div className="flex-1 max-w-2xl h-11 sm:h-14 rounded-full bg-slate-100 animate-pulse" />
          <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-2xl bg-slate-100 animate-pulse" />
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 mt-6 sm:mt-10">
        <div className="h-12 w-72 max-w-full rounded-full bg-white shadow-sm animate-pulse mb-8" />
        <div className="h-9 w-56 rounded-lg bg-slate-200/70 animate-pulse mb-8" />
        <VideoGridSkeleton />
      </main>
    </div>
  );
}
