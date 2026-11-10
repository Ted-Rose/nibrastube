"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

// A Link that prefetches its route on pointer-down — the server round
// trip overlaps the press instead of starting on click, so the watch
// page's first paint arrives sooner. Used by feed video cards, whose
// href is always a /watch/ route.
export function PrefetchLink({
  href,
  onPointerDown,
  ...props
}: ComponentProps<typeof Link>) {
  const router = useRouter();
  return (
    <Link
      href={href}
      onPointerDown={(e) => {
        // href may be a UrlObject whose pathname drops search/hash —
        // only string hrefs carry the full route, so skip the rest.
        if (typeof href === "string") router.prefetch(href);
        onPointerDown?.(e);
      }}
      {...props}
    />
  );
}
