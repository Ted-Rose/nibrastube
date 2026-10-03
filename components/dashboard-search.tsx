"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { MagnifyingGlass, SpinnerGap } from "@phosphor-icons/react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface DashboardSearchProps {
  profileId: string;
  searchType: "videos" | "channels";
  query: string;
}

// GET-search via router.push inside startTransition — a native
// <form method="GET"> submits as a full document navigation, so neither
// useFormStatus nor the route's loading.tsx would render feedback (worst
// in the Android WebView, where there's no browser-chrome spinner).
export function DashboardSearch({
  profileId,
  searchType,
  query,
}: DashboardSearchProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get("q") ?? "");
    startTransition(() => {
      // Same param order as dashboardHref: profileId, q, type.
      router.push(
        `/parent/dashboard?profileId=${profileId}${q ? `&q=${encodeURIComponent(q)}` : ""}&type=${searchType}`
      );
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <div className="relative flex-1">
        <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
        <Input
          key={query}
          name="q"
          placeholder={searchType === "channels" ? "Search YouTube channels (e.g., Cocomelon, Nat Geo Kids)..." : "Search YouTube (e.g., Cocomelon, Nat Geo Kids)..."}
          defaultValue={query}
          className="pl-10 h-14 text-lg bg-background border-2"
        />
      </div>
      <Button type="submit" disabled={isPending} size="lg" className="px-8 h-14 text-lg">
        {isPending ? (
          <>
            <SpinnerGap className="animate-spin" />
            Searching…
          </>
        ) : (
          "Search"
        )}
      </Button>
    </form>
  );
}
