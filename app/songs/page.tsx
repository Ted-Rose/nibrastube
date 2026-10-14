import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { VideoGridSkeleton } from "@/components/video-grid-skeleton";
import { getSession } from "@/lib/auth";
import {
  parseSongsFeedParams,
  songsCatalogUrl,
  type SongsFeedParams,
  type SongsView,
} from "@/lib/songs-feed";
import { CatalogHeader } from "./_components/catalog-header";
import { FeedContent } from "./_components/feed-content";
import { SONGS_VIEWS, tabIcon } from "./_components/view-config";

export const metadata: Metadata = {
  // absolute — the layout's "%s | NibrasTube" template would double the
  // brand on "NibrasTube Songs".
  title: { absolute: "NibrasTube Songs" },
  description:
    "Every song parents have imported from timestamped YouTube " +
    "compilations — browse the catalog, no sign-in needed.",
};

interface SongsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// The public song catalog — no sign-in required. The session only
// switches sections on: a signed-in parent gets the "Yours" tab, the
// "Your imports" shelf, delete menus on their own rows and a Parent
// portal link; anonymous visitors (and kid-locked devices, which carry
// no session) get the read-only catalog plus a signup invite.
export default async function SongsPage({ searchParams }: SongsPageProps) {
  const session = await getSession();
  const feed = parseSongsFeedParams(await searchParams, !!session);
  const { view } = feed;

  const tabDefs: readonly (readonly [
    SongsView,
    Partial<SongsFeedParams>,
  ])[] = [
    ["songs", { view: "songs", video: null }],
    ["compilations", { view: "compilations", video: null }],
    ...(session
      ? ([["mine", { view: "mine", video: null }]] as const)
      : []),
  ];
  const tabs = tabDefs.map(([key, overrides]) => {
    const active = view === key;
    return {
      key,
      label: SONGS_VIEWS[key].label,
      href: songsCatalogUrl(feed, overrides),
      active,
      icon: tabIcon(key, active),
    };
  });

  return (
    <div className="min-h-screen bg-[#F0F4FF]">
      <CatalogHeader feed={feed} tabs={tabs} signedIn={!!session} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 mt-6 sm:mt-10">
        {!session && (
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-[32px] bg-white px-6 py-4 shadow-sm sm:px-8">
            <p className="max-w-2xl text-base font-bold text-slate-600">
              Curating parents add these songs from their own
              compilations. Create a free account to import yours.
            </p>
            <Link
              href="/signup"
              className="inline-flex h-11 shrink-0 items-center rounded-full bg-primary px-6 text-base font-black text-white shadow-md transition-transform focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 motion-safe:hover:scale-105"
            >
              Sign up
            </Link>
          </div>
        )}

        <Suspense fallback={<VideoGridSkeleton />}>
          <FeedContent feed={feed} userId={session?.user.id ?? null} />
        </Suspense>
      </main>
    </div>
  );
}
