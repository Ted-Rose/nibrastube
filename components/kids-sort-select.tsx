"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CaretDown } from "@phosphor-icons/react";

const OPTIONS = [
  { value: "age:desc", label: "Newest first" },
  { value: "age:asc", label: "Oldest first" },
  { value: "status:asc", label: "Not watched first" },
  { value: "status:desc", label: "Watched first" },
] as const;

// `value` is the validated "<sort>:<dir>" pair from the server.
export function KidsSortSelect({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const [sort, dir] = e.target.value.split(":");
    const sp = new URLSearchParams(searchParams.toString());
    if (sort === "age") sp.delete("sort");
    else sp.set("sort", sort);
    if (dir === "desc") sp.delete("dir");
    else sp.set("dir", dir);
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="relative">
      <select
        value={value}
        onChange={onChange}
        aria-label="Sort videos"
        className="appearance-none h-12 rounded-full border-4 border-slate-100 bg-white pl-5 pr-12 text-lg font-bold text-slate-700 shadow-sm cursor-pointer focus:outline-none focus:border-primary transition-colors"
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
