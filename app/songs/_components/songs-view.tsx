import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { MusicNotes } from "@phosphor-icons/react/dist/ssr";
import { db } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import {
  getSongs,
  songsCatalogUrl,
  type SongsFeedParams,
} from "@/lib/songs-feed";
import { BackLink } from "@/components/back-link";
import { EmptyState } from "@/components/empty-state";
import { FeedHeader } from "@/components/feed-header";
import { KidsSortChips } from "@/components/kids-sort-chips";
import { SongCatalogGrid } from "@/components/song-catalog-grid";
import {
  ShelfSkeleton,
  VideoGridSkeleton,
} from "@/components/video-grid-skeleton";
import { HomeShelves } from "./home-shelves";
import { feedTitle, sortOptions, SONGS_VIEWS } from "./view-config";

// The Songs tab (and the signed-in Yours tab) plus the ?video=
// compilation drill-in — all render the song grid. The plain Songs tab
// (no search, no drill-in) is the home layout: shelves above the "All
// songs" grid, each streaming in its own Suspense boundary.
export async function SongsView({
  feed,
  userId,
  hasSession,
  profileId,
}: {
  feed: SongsFeedParams;
  userId: string | null;
  // Any signed-in session — suppresses the "Sign up free" CTA that
  // only bounces a kid session back to its feed.
  hasSession: boolean;
  profileId: string | null;
}) {
  const { video, q: query } = feed;
  const drilledIn = feed.view === "songs" && video !== null;

  if (feed.view === "songs" && video === null && !query) {
    return (
      <>
        <Suspense fallback={<ShelfSkeleton />}>
          <HomeShelves
            feed={feed}
            userId={userId}
            profileId={profileId}
          />
        </Suspense>
        <Suspense fallback={<VideoGridSkeleton />}>
          <AllSongsGrid
            feed={feed}
            userId={userId}
            hasSession={hasSession}
            profileId={profileId}
          />
        </Suspense>
      </>
    );
  }

  const rows = await getSongs(
    feed,
    userId ?? undefined,
    profileId ?? undefined
  );

  let videoTitle: string | null = null;
  if (drilledIn) {
    videoTitle =
      rows[0]?.videoTitle ??
      (
        await db.query.videos.findFirst({
          where: eq(videos.id, video),
        })
      )?.title ??
      "Compilation";
  }

  const EmptyIcon = SONGS_VIEWS[feed.view].icon;
  const emptyMessage = query ? "No songs found!" : "No songs yet!";
  const emptyAction = query
    ? {
        label: "Clear search",
        href: songsCatalogUrl(feed, { q: "" }),
      }
    : drilledIn
      ? {
          // Same "All channels" convention as the kids drill-in:
          // empty search aside, the way out is back to the tiles.
          label: "All compilations",
          href: songsCatalogUrl(feed, {
            view: "compilations",
            video: null,
          }),
        }
      : userId
        ? {
            label: "Import songs",
            // proxy.ts 307s signed-in-but-locked parents to the PIN
            // gate — don't prefetch the redirect (see
            // catalog-header.tsx).
            href: "/parent/dashboard",
            prefetch: false,
          }
        : hasSession
          ? // Kid session on an empty grid — signup is a dead-end
            // redirect back to their feed, and they can't import.
            undefined
          : {
              label: "Sign up free",
              href: "/signup",
            };

  return (
    <>
      {drilledIn && (
        <BackLink
          href={songsCatalogUrl(feed, {
            view: "compilations",
            video: null,
          })}
        >
          All compilations
        </BackLink>
      )}

      <FeedHeader
        title={feedTitle(feed, { videoTitle })}
        actions={<KidsSortChips options={sortOptions(feed)} />}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<EmptyIcon size={48} weight="fill" />}
          message={emptyMessage}
          action={emptyAction}
        />
      ) : (
        <SongCatalogGrid rows={rows} playerBase={songsCatalogUrl(feed)} />
      )}
    </>
  );
}

// The full song grid under the home shelves — its own async component
// so it streams independently of them. The grid's cards all load
// lazily; the shelves' first cards are the eager ones.
async function AllSongsGrid({
  feed,
  userId,
  hasSession,
  profileId,
}: {
  feed: SongsFeedParams;
  userId: string | null;
  hasSession: boolean;
  profileId: string | null;
}) {
  const rows = await getSongs(
    feed,
    userId ?? undefined,
    profileId ?? undefined
  );

  return (
    <>
      <FeedHeader
        title="All songs"
        actions={<KidsSortChips options={sortOptions(feed)} />}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<MusicNotes size={48} weight="fill" />}
          message="No songs yet!"
          action={
            userId
              ? {
                  label: "Import songs",
                  // /parent/* 307s for locked parents — don't prefetch
                  // the redirect (see catalog-header.tsx).
                  href: "/parent/dashboard",
                  prefetch: false,
                }
              : hasSession
                ? // Kid session — signup would just redirect back.
                  undefined
                : {
                    label: "Sign up free",
                    href: "/signup",
                  }
          }
        />
      ) : (
        <SongCatalogGrid
          rows={rows}
          playerBase={songsCatalogUrl(feed)}
          eagerCount={0}
        />
      )}
    </>
  );
}
