import type { RefObject } from "react";
import { cn } from "@/lib/utils";

// Shared sentinel for useTokenPager callers — the div is what the
// hook's IntersectionObserver watches; the button doubles as the
// manual fallback/retry.
export function TokenPagerSentinel({
  sentinelRef,
  fetching,
  failed,
  onClick,
  label,
}: {
  sentinelRef: RefObject<HTMLDivElement | null>;
  fetching: boolean;
  failed: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <div ref={sentinelRef} className="flex justify-center pt-8">
      <button
        type="button"
        disabled={fetching}
        onClick={onClick}
        className={cn(
          "rounded-full bg-white px-8 py-3 text-lg font-bold",
          "text-slate-500 shadow-sm transition-colors",
          "hover:text-slate-800 focus-visible:outline-none",
          "focus-visible:ring-4 focus-visible:ring-primary/40",
          "disabled:opacity-60"
        )}
      >
        {fetching
          ? "Loading…"
          : failed
            ? "Couldn't load more — retry"
            : label}
      </button>
    </div>
  );
}
