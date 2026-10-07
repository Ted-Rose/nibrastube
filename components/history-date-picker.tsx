"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTransition } from "react";
import { SpinnerGap } from "@phosphor-icons/react";
import { LinkPendingSpinner } from "./link-pending-spinner";

// Date picker for the History tab — updates the ?date= URL param like
// KidsSortSelect does for sort/dir. Picking a day server-filters the
// history rows; "All days" clears the filter.
export function HistoryDatePicker({ date }: { date: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const today = new Date().toLocaleDateString("en-CA");

  const allDaysParams = new URLSearchParams(searchParams.toString());
  allDaysParams.delete("date");
  const allDaysQs = allDaysParams.toString();
  const allDaysHref = allDaysQs ? `${pathname}?${allDaysQs}` : pathname;

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (e.target.value) sp.set("date", e.target.value);
    else sp.delete("date");
    const qs = sp.toString();
    // Same-route param change — router.push inside startTransition so
    // isPending can drive a spinner (loading.tsx never fires here).
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  };

  return (
    <div className="flex items-center gap-3">
      {date && (
        <Link
          href={allDaysHref}
          className="rounded-full bg-white px-4 py-2 text-base font-bold text-slate-500 shadow-sm hover:text-slate-800 transition-colors"
        >
          All days
          <LinkPendingSpinner
            size={16}
            weight="bold"
            className="ml-2 inline-block align-middle"
          />
        </Link>
      )}
      <div className="relative">
        <input
          type="date"
          value={date ?? ""}
          max={today}
          onChange={onChange}
          aria-label="Pick a day"
          className="h-11 rounded-full border-4 border-slate-100 bg-white px-4 text-base font-bold text-slate-700 shadow-sm cursor-pointer focus:outline-none focus:border-primary transition-colors"
        />
        {isPending && (
          <SpinnerGap
            size={18}
            weight="bold"
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400"
          />
        )}
      </div>
    </div>
  );
}
