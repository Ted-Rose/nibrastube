import Link from "next/link";
import type { ReactNode } from "react";
import { LinkPendingSpinner } from "@/components/link-pending-spinner";
import { KIDS_VIEWS } from "@/app/kids/[profileId]/_components/view-config";
import { cn } from "@/lib/utils";
import type { KidsView } from "@/lib/kids-feed";

export interface KidsViewTab {
  key: KidsView;
  label: string;
  href: string;
  active: boolean;
}

// Same weights the burger menu used: Play is always filled, the Liked
// and Playlists icons fill in when their tab is active.
const iconFor = (key: KidsView, active: boolean): ReactNode => {
  const ViewIcon = KIDS_VIEWS[key].icon;
  const filled =
    key === "videos" ||
    ((key === "liked" || key === "playlists") && active);
  return <ViewIcon size={22} weight={filled ? "fill" : "bold"} />;
};

// The five kids feeds as an always-visible tab strip. Phones get five
// equal tiles with the icon over a short label; sm+ shows inline pills.
// Drill-ins keep their tab lit because a tab is active purely on
// feed.view (a channel drill-in still has view=channels). Each tab swaps
// its icon for a spinner via LinkPendingSpinner — param-only navigations
// never fire loading.tsx.
export function KidsViewTabs({ tabs }: { tabs: KidsViewTab[] }) {
  return (
    <nav
      aria-label="Views"
      className="grid grid-cols-5 gap-0.5 pb-2 sm:flex sm:gap-2 sm:pb-3"
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
            fallback={iconFor(tab.key, tab.active)}
          />
          <span className="text-[11px] leading-tight sm:text-sm md:text-base">
            {tab.label}
          </span>
        </Link>
      ))}
    </nav>
  );
}
