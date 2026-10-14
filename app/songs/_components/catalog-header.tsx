import Link from "next/link";
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
// dashboard. Kid-locked devices have no session, so they see the
// anonymous chrome.
export function CatalogHeader({
  feed,
  tabs,
  signedIn,
}: {
  feed: SongsFeedParams;
  tabs: KidsViewTab[];
  signedIn: boolean;
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
              <Link
                href="/login"
                className="inline-flex h-11 shrink-0 items-center rounded-full px-4 text-base font-black text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
              >
                Log in
              </Link>
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
