import Link from "next/link";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { Children, type ReactNode } from "react";
import { LinkPendingSpinner } from "./link-pending-spinner";

// A labelled, horizontally scrolling card row for the home view
// ("Continue watching", "New for you", …). Cards bleed to the screen
// edge on phones and scroll-snap to the row start; the scrollbar stays
// hidden like the sort chips. Each child is wrapped in a fixed-width
// snap item. The vertical padding gives the card's hover lift and
// shadow room — overflow-y computes to auto once overflow-x is set, so
// they would clip against the scroll box otherwise.
export function VideoShelf({
  title,
  seeAllHref,
  children,
}: {
  title: string;
  seeAllHref?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="mb-10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-2xl font-black tracking-tight text-slate-900">
          {title}
        </h2>
        {seeAllHref && (
          <Link
            href={seeAllHref}
            className="inline-flex h-11 shrink-0 items-center gap-1 rounded-full px-4 text-base font-black text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
          >
            See all
            <LinkPendingSpinner
              size={18}
              weight="bold"
              fallback={<CaretRight size={18} weight="bold" />}
            />
          </Link>
        )}
      </div>
      <div
        data-drag-scroll
        className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 py-2 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden"
      >
        {Children.map(children, (child) => (
          <div className="w-[72vw] max-w-72 shrink-0 snap-start sm:w-72">
            {child}
          </div>
        ))}
      </div>
    </section>
  );
}
