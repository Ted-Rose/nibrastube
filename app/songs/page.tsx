import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { VideoGridSkeleton } from "@/components/video-grid-skeleton";
import { getSession, isKidSession, parentSession } from "@/lib/auth";
import {
  parseSongsFeedParams,
  songsCatalogUrl,
  type SongsFeedParams,
  type SongsView,
} from "@/lib/songs-feed";
import { CatalogHeader } from "./_components/catalog-header";
import { FeedContent } from "./_components/feed-content";
import { SongOverlay } from "./_components/song-overlay";
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

// The public song catalog — no sign-in required. A parent session
// switches sections on: the "Yours" tab, the "Your imports" shelf,
// delete menus on their own rows and a Parent portal link; anonymous
// visitors (and kid-locked devices, which carry no session) get the
// read-only catalog plus a signup invite; kid sessions get the
// read-only catalog plus a Videos pill back to their feed.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SongsPage({ searchParams }: SongsPageProps) {
  const session = await getSession();
  const parent = parentSession(session);
  const kid = isKidSession(session) ? session : null;
  const raw = await searchParams;
  const feed = parseSongsFeedParams(raw, !!parent);
  const { view } = feed;

  // ?song=<uuid> opens the in-app player overlay on top of this feed.
  // It's validated here but deliberately left out of feed params — a
  // bad id renders no overlay, it never 404s.
  const rawSong = Array.isArray(raw.song) ? raw.song[0] : raw.song;
  const songId = rawSong && UUID_RE.test(rawSong) ? rawSong : null;

  // Kids need a way back to their feed from this public page: a kid
  // session links to its own profileId; a kid-locked device (no
  // session, but an activeProfileId cookie) links to that profile —
  // otherwise a kid who followed the Songs button is stranded here.
  const activeProfileId = (await cookies()).get("activeProfileId")?.value;
  const kidsHref = kid
    ? `/kids/${kid.profileId}`
    : !session && activeProfileId && UUID_RE.test(activeProfileId)
      ? `/kids/${activeProfileId}`
      : null;

  const userId = parent?.id ?? null;

  const tabDefs: readonly (readonly [
    SongsView,
    Partial<SongsFeedParams>,
  ])[] = [
    ["songs", { view: "songs", video: null }],
    ["compilations", { view: "compilations", video: null }],
    ...(parent
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
      <CatalogHeader
        feed={feed}
        tabs={tabs}
        signedIn={!!parent}
        kidsHref={kidsHref}
      />

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
          <FeedContent feed={feed} userId={userId} />
        </Suspense>
      </main>

      {songId && (
        <Suspense fallback={null}>
          <SongOverlay
            songId={songId}
            feed={feed}
            userId={userId}
            closeHref={songsCatalogUrl(feed)}
          />
        </Suspense>
      )}
    </div>
  );
}
