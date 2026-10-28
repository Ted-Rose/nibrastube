import Link from "next/link";
import { Play } from "@phosphor-icons/react/dist/ssr";
import { KidsHeader } from "@/components/kids-header";
import { KidsSearch } from "@/components/kids-search";
import {
  KidsViewTabs,
  type KidsViewTab,
} from "@/components/kids-view-tabs";
import { LinkPendingSpinner } from "@/components/link-pending-spinner";
import type { SongsFeedParams } from "@/lib/songs-feed";
import { searchPlaceholder } from "./view-config";

// The catalog's sticky header — the KidsHeader shell with the brand,
// type-ahead search and the view tabs. Anonymous visitors get Log in /
// Sign up links on the right; signed-in parents get a way back to the
// dashboard; kid-locked devices (no session, but an activeProfileId
// cookie) additionally get a Videos pill back to their feed — the
// Songs button in the kids header leads here, and this is the way back.
export function CatalogHeader({
  feed,
  tabs,
  signedIn,
  kidsHref,
}: {
  feed: SongsFeedParams;
  tabs: KidsViewTab[];
  signedIn: boolean;
  // /kids/<activeProfileId> for locked kid devices, null otherwise.
  kidsHref: string | null;
}) {
  return (
    <KidsHeader
      row1={
        <>
          <Link
            href="/songs"
            className="hidden shrink-0 rounded-lg px-1 py-2 text-xl font-black text-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 md:block"
          >
            <LinkPendingSpinner
              size={20}
              weight="bold"
              fallback={<>NibrasTube</>}
            />
          </Link>
          <div className="min-w-0 flex-1">
            <KidsSearch
              query={feed.q}
              placeholder={searchPlaceholder(feed)}
              // ?song= is not a feed param — searching drops it so the
              // player overlay closes.
              stripParams={["song"]}
            />
          </div>
          {signedIn ? (
            <Link
              href="/parent/dashboard"
              // Auth-conditional: proxy.ts redirects to the PIN gate
              // when the device isn't unlocked — a prefetched redirect
              // would pollute the router's segment cache, so resolve
              // it fresh on click.
              prefetch={false}
              className="inline-flex h-11 shrink-0 items-center rounded-full bg-primary px-5 text-base font-black text-white shadow-md transition-transform focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 motion-safe:hover:scale-105"
            >
              Parent portal
            </Link>
          ) : (
            <>
              {kidsHref ? (
                // The locked device already carries the matching
                // activeProfileId cookie, so /kids/<id> resolves to the
                // feed rather than a redirect — safe to prefetch.
                <Link
                  href={kidsHref}
                  aria-label="Back to videos"
                  className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-base font-black text-white shadow-md transition-transform focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 motion-safe:hover:scale-105 sm:px-5"
                >
                  <Play size={18} weight="fill" className="sm:hidden" />
                  Videos
                </Link>
              ) : (
                <Link
                  href="/login"
                  className="inline-flex h-11 shrink-0 items-center rounded-full px-4 text-base font-black text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
                >
                  Log in
                </Link>
              )}
              <Link
                href="/signup"
                className="inline-flex h-11 shrink-0 items-center rounded-full bg-primary px-5 text-base font-black text-white shadow-md transition-transform focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 motion-safe:hover:scale-105"
              >
                Sign up free
              </Link>
            </>
          )}
        </>
      }
      tabs={<KidsViewTabs tabs={tabs} />}
    />
  );
}
