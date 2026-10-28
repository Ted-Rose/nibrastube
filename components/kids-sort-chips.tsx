import Link from "next/link";
import { cn } from "@/lib/utils";
import { LinkPendingSpinner } from "./link-pending-spinner";

// Sort picker for the videos grid — a nav of plain links, one per
// sort:dir pair, with hrefs prebuilt via kidsPortalUrl. Sort changes
// only rewrite ?sort/?dir, so loading.tsx never fires and each chip
// carries its own LinkPendingSpinner; scroll={false} keeps the scroll
// position. The nav itself scrolls horizontally on narrow phones:
// standalone (a FeedHeader's sole action) it wraps to its own row and
// clips to max-w-full; inside a scrolling actions row shrink-0 keeps
// it at natural width.
export function KidsSortChips({
  options,
}: {
  options: { key: string; label: string; href: string; active: boolean }[];
}) {
  return (
    <nav
      aria-label="Sort videos"
      data-drag-scroll
      className="flex max-w-full shrink-0 gap-2 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:ml-auto"
    >
      {options.map((o) => (
        <Link
          key={o.key}
          href={o.href}
          scroll={false}
          aria-current={o.active ? "true" : undefined}
          className={cn(
            "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full px-5 text-base font-black transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40",
            o.active
              ? "bg-primary text-white"
              : "bg-white text-slate-600 shadow-sm"
          )}
        >
          {o.label}
          <LinkPendingSpinner size={16} weight="bold" />
        </Link>
      ))}
    </nav>
  );
}
