import Link from "next/link";
import {
  DeviceMobile,
  Play,
  SquaresFour,
} from "@phosphor-icons/react/dist/ssr";
import {
  kidsPortalUrl,
  type KidsFeedParams,
  type KidsType,
} from "@/lib/kids-feed";
import { cn } from "@/lib/utils";
import { LinkPendingSpinner } from "./link-pending-spinner";

const OPTIONS: { type: KidsType; label: string; icon: typeof Play }[] = [
  { type: "all", label: "All", icon: SquaresFour },
  { type: "videos", label: "Videos", icon: Play },
  { type: "shorts", label: "Shorts", icon: DeviceMobile },
];

// "All | Videos | Shorts" segmented control — rewrites ?type= while
// every other feed param rides along via kidsPortalUrl. Rendered in the
// FeedHeader actions of each video-listing view; param-only navigation
// never fires loading.tsx, so each option carries a LinkPendingSpinner
// and scroll={false} keeps the scroll position.
export function KidsTypeFilter({
  profileId,
  feed,
}: {
  profileId: string;
  feed: KidsFeedParams;
}) {
  return (
    <nav
      aria-label="Filter by type"
      className="inline-flex h-11 shrink-0 items-center gap-1 overflow-x-auto rounded-full bg-white p-1 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {OPTIONS.map((o) => {
        const active = feed.type === o.type;
        const Icon = o.icon;
        return (
          <Link
            key={o.type}
            href={kidsPortalUrl(profileId, feed, { type: o.type })}
            scroll={false}
            aria-current={active ? "true" : undefined}
            className={cn(
              "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-black transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 sm:text-base",
              active
                ? "bg-primary text-white"
                : "text-slate-500 hover:text-slate-800"
            )}
          >
            <LinkPendingSpinner
              size={16}
              weight="bold"
              fallback={
                <Icon size={16} weight={active ? "fill" : "bold"} />
              }
            />
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}
