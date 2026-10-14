import Link from "next/link";
import { LinkPendingSpinner } from "@/components/link-pending-spinner";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface KidsViewTab {
  key: string;
  label: string;
  href: string;
  active: boolean;
  // Rendered as the tab's LinkPendingSpinner fallback — the caller picks
  // the icon and its weight from its own view table, so this strip serves
  // any feed (kids portal, /songs catalog), not just the kids views.
  icon: ReactNode;
}

// The feed views as an always-visible tab strip. Phones get equal tiles
// with the icon over a short label; sm+ shows inline pills. Drill-ins
// keep their tab lit because a tab is active purely on feed.view. Each
// tab swaps its icon for a spinner via LinkPendingSpinner — param-only
// navigations never fire loading.tsx.
export function KidsViewTabs({ tabs }: { tabs: KidsViewTab[] }) {
  return (
    <nav
      aria-label="Views"
      className="grid gap-0.5 pb-2 sm:flex sm:gap-2 sm:pb-3"
      // The kids feed has 5 tabs, the songs catalog 2-3 — any static
      // grid-cols-N would leave orphans, so size the phone columns to
      // the actual tab count.
      style={{
        gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
      }}
    >
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-2xl px-0.5 py-1.5 font-black",
            "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40",
            "sm:h-11 sm:min-h-0 sm:flex-row sm:gap-1.5 sm:rounded-full sm:px-4",
            tab.active
              ? "bg-primary/10 text-primary sm:bg-primary sm:text-white"
              : "text-slate-500 hover:bg-slate-100 sm:text-slate-600"
          )}
        >
          <LinkPendingSpinner
            size={22}
            weight="bold"
            fallback={tab.icon}
          />
          <span className="text-[11px] leading-tight sm:text-sm md:text-base">
            {tab.label}
          </span>
        </Link>
      ))}
    </nav>
  );
}
