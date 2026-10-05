export default function KidsLoading() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-4">
      <div className="flex-1 flex flex-col items-center justify-center w-full">
        <div className="h-12 md:h-16 w-72 md:w-96 rounded-lg bg-slate-200 animate-pulse mb-12" />
        <div className="max-w-5xl w-full grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center">
              <div className="w-full aspect-square rounded-3xl bg-white shadow-xl animate-pulse" />
              <div className="mt-6 h-8 w-24 rounded bg-slate-200 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
