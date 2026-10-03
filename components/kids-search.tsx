"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { MagnifyingGlass, SpinnerGap } from "@phosphor-icons/react";
import { Input } from "./ui/input";
import type { KidsDir, KidsSort, KidsView } from "@/lib/kids-feed";

interface KidsSearchProps {
  profileId: string;
  view: KidsView;
  channel: string | null;
  sort: KidsSort;
  dir: KidsDir;
  query: string;
  placeholder: string;
}

// Enter-only GET search. Uses router.push inside startTransition instead
// of a native <form method="GET"> submission — the latter is a full
// document navigation with no pending state and no loading.tsx fallback,
// which leaves the Android WebView looking frozen. The URL is built here
// (not via kidsFeedQuery) because lib/kids-feed.ts pulls in the
// server-side db client; the defaults-dropping and param order mirror it.
export function KidsSearch({
  profileId,
  view,
  channel,
  sort,
  dir,
  query,
  placeholder,
}: KidsSearchProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get("q") ?? "");
    const sp = new URLSearchParams();
    if (view !== "videos") sp.set("view", view);
    if (channel) sp.set("channel", channel);
    if (sort !== "status") sp.set("sort", sort);
    if (dir !== "asc") sp.set("dir", dir);
    if (q) sp.set("q", q);
    const qs = sp.toString();
    startTransition(() => {
      router.push(`/kids/${profileId}${qs ? `?${qs}` : ""}`);
    });
  };

  return (
    <div className="relative order-last basis-full min-w-0 sm:order-none sm:basis-auto sm:flex-1 sm:max-w-2xl">
      <MagnifyingGlass className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={24} weight="fill" />
      <form onSubmit={onSubmit}>
        <Input
          key={query}
          name="q"
          defaultValue={query}
          placeholder={placeholder}
          className="pl-12 sm:pl-14 h-11 sm:h-14 text-base sm:text-xl rounded-full border-4 border-slate-50 bg-slate-50 text-slate-900 focus:bg-white transition-all shadow-inner"
        />
        {isPending && (
          <SpinnerGap className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-slate-400" size={24} />
        )}
      </form>
    </div>
  );
}
