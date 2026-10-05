export default function WatchLoading() {
  return (
    <div className="min-h-screen bg-black flex flex-col">
      <div className="bg-slate-900/80 px-3 sm:px-6 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-[max(1rem,env(safe-area-inset-top))] pb-3 sm:pb-4 flex items-center justify-between gap-2 border-b border-slate-800">
        <div className="h-9 w-28 rounded-md bg-slate-800 animate-pulse" />
        <div className="h-6 w-1/2 max-w-md rounded bg-slate-800 animate-pulse" />
        <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-white/10 animate-pulse" />
      </div>
      <div className="flex-1 flex items-center justify-center p-4 md:p-10">
        <div className="w-full max-w-6xl aspect-video rounded-[32px] border-4 border-slate-800 bg-slate-900 animate-pulse" />
      </div>
      <div className="bg-slate-900/50 p-4 sm:p-8 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-[max(2rem,env(safe-area-inset-bottom))] flex items-center justify-center gap-3">
        <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-3xl bg-slate-800 animate-pulse" />
        <div className="space-y-2">
          <div className="h-3 w-24 rounded bg-slate-800 animate-pulse" />
          <div className="h-6 w-32 rounded bg-slate-800 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
