"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CaretDown } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "status:asc", label: "Not watched first" },
  { value: "status:desc", label: "Watched first" },
  { value: "age:desc", label: "Newest first" },
  { value: "age:asc", label: "Oldest first" },
] as const;

// `value` is the validated "<sort>:<dir>" pair from the server.
export function KidsSortSelect({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const [sort, dir] = e.target.value.split(":");
    const sp = new URLSearchParams(searchParams.toString());
    if (sort === "status") sp.delete("sort");
    else sp.set("sort", sort);
    if (dir === "asc") sp.delete("dir");
    else sp.set("dir", dir);
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className={cn("relative", className)}>
      <select
        value={value}
        onChange={onChange}
        aria-label="Sort videos"
        className="w-full appearance-none h-11 sm:h-12 rounded-full border-4 border-slate-100 bg-white pl-5 pr-12 text-base sm:text-lg font-bold text-slate-700 shadow-sm cursor-pointer focus:outline-none focus:border-primary transition-colors"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <CaretDown
        size={20}
        weight="bold"
        className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400"
      />
    </div>
  );
}
