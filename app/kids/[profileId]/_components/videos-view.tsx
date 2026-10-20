import { Suspense } from "react";
import { and, eq } from "drizzle-orm";
import { Play } from "@phosphor-icons/react/dist/ssr";
import { db } from "@/lib/db";
import { channels, whitelistedChannels } from "@/lib/db/schema";
import {
  getKidsVideos,
  getPlaylists,
  kidsFeedQuery,
  kidsPortalUrl,
  maxLenLabel,
  type KidsFeedParams,
} from "@/lib/kids-feed";
import { EmptyState } from "@/components/empty-state";
import { KidsLengthFilter } from "@/components/kids-length-filter";
import { KidsTypeFilter } from "@/components/kids-type-filter";
import { KidsVideoGrid } from "@/components/kids-video-grid";
import { KidsSortChips } from "@/components/kids-sort-chips";
import { SaveToPlaylistProvider } from "@/components/save-to-playlist-dialog";
import {
  ShelfSkeleton,
  VideoGridSkeleton,
} from "@/components/video-grid-skeleton";
import { BackLink } from "@/components/back-link";
import { FeedHeader } from "@/components/feed-header";
import { HomeShelves } from "./home-shelves";
import { feedTitle, KIDS_VIEWS } from "./view-config";

// Sort chip order — default (status:asc) first. kidsFeedQuery drops
// default sort/dir values, so the default chip's href stays clean.
const SORT_OPTIONS = [
  { sort: "status", dir: "asc", label: "Not watched" },
  { sort: "status", dir: "desc", label: "Watched" },
  { sort: "age", dir: "desc", label: "Newest" },
  { sort: "age", dir: "asc", label: "Oldest" },
] as const;

function sortOptions(profileId: string, feed: KidsFeedParams) {
  return SORT_OPTIONS.map((o) => ({
    key: `${o.sort}:${o.dir}`,
    label: o.label,
    href: kidsPortalUrl(profileId, feed, { sort: o.sort, dir: o.dir }),
    active: o.sort === feed.sort && o.dir === feed.dir,
  }));
}

// The Videos tab and the channel drill-in (view=channels&channel=…) —
// both render the whitelisted-videos grid, the drill-in filtered to one
// channel with an "All channels" back link on top. The plain Videos tab
// (no search, no drill-in) is the home layout: shelves above the "All
// videos" grid, each streaming in its own Suspense boundary.
export async function VideosView({
  profileId,
  feed,
}: {
  profileId: string;
  feed: KidsFeedParams;
}) {
  const { channel, q: query } = feed;
  const drilledIn = feed.view === "channels" && channel !== null;

  if (channel === null && !query) {
    return (
      <>
        {/* The type/length filters scope the whole page — shelves and
            the All-videos grid alike — so on the home layout they sit
            on top instead of inside a section header. */}
        <div className="mb-6 flex flex-wrap justify-end gap-3">
          <KidsTypeFilter profileId={profileId} feed={feed} />
          <KidsLengthFilter maxLen={feed.maxLen} />
        </div>
        <Suspense fallback={<ShelfSkeleton />}>
          <HomeShelves profileId={profileId} feed={feed} />
        </Suspense>
        <Suspense fallback={<VideoGridSkeleton />}>
          <AllVideosGrid profileId={profileId} feed={feed} />
        </Suspense>
      </>
    );
  }

  const rows = await getKidsVideos(profileId, {
    q: query,
    channelId: channel,
    sort: feed.sort,
    dir: feed.dir,
    type: feed.type,
    maxLen: feed.maxLen,
  });
  // Playlists snapshot — feeds the shared "Save to playlist" dialog
  // behind every video card's ⋮ menu.
  const playlistRows = await getPlaylists(profileId);

  let channelTitle: string | null = null;
  let channelApproved = false;
  if (drilledIn) {
    channelTitle =
      rows[0]?.video.channelTitle ??
      (
        await db.query.channels.findFirst({
          where: eq(channels.id, channel),
        })
      )?.title ??
      "Channel";
    if (rows.length === 0) {
      channelApproved = !!(await db.query.whitelistedChannels.findFirst({
        where: and(
          eq(whitelistedChannels.profileId, profileId),
          eq(whitelistedChannels.channelId, channel)
        ),
      }));
    }
  }

  // A channel drill-in renders the videos grid, so its search-empty
  // icon is the videos icon (Play), not the channels one — or the
  // shorts icon when the type filter produced the empty grid.
  const EmptyIcon =
    feed.type === "shorts"
      ? KIDS_VIEWS.shorts.icon
      : query && channel === null
        ? KIDS_VIEWS[feed.view].icon
        : Play;
  const emptyMessage = query
    ? feed.type === "shorts"
      ? "No shorts found!"
      : "No videos found!"
    : feed.type === "shorts"
      ? "No shorts here yet!"
      : feed.type === "videos"
        ? "No videos here yet!"
        : feed.maxLen !== null
          ? `No videos under ${maxLenLabel(feed.maxLen)} yet!`
          : channelApproved
            ? "Videos are on the way!"
            : "Ask a grown-up to pick some videos!";
  const emptyAction = query
    ? {
        label: "Clear search",
        href: kidsPortalUrl(profileId, feed, { q: "" }),
      }
    : feed.type !== "all" || feed.maxLen !== null
      ? {
          label: "Show everything",
          href: kidsPortalUrl(profileId, feed, {
            type: "all",
            maxLen: null,
          }),
        }
      : channelApproved
        ? {
            label: "All channels",
            href: kidsPortalUrl(profileId, feed, { channel: null }),
          }
        : undefined;

  return (
    <>
      {drilledIn && (
        <BackLink href={kidsPortalUrl(profileId, feed, { channel: null })}>
          All channels
        </BackLink>
      )}

      <FeedHeader
        title={feedTitle(feed, { channelTitle })}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <KidsTypeFilter profileId={profileId} feed={feed} />
            <KidsLengthFilter maxLen={feed.maxLen} />
            <KidsSortChips options={sortOptions(profileId, feed)} />
          </div>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<EmptyIcon size={48} weight="fill" />}
          message={emptyMessage}
          action={emptyAction}
        />
      ) : (
        <SaveToPlaylistProvider
          profileId={profileId}
          playlists={playlistRows}
        >
          <KidsVideoGrid
            rows={rows}
            profileId={profileId}
            feedQuery={kidsFeedQuery(feed)}
          />
        </SaveToPlaylistProvider>
      )}
    </>
  );
}

// The full whitelisted-videos grid under the home shelves — its own
// async component so it streams independently of them. The grid's cards
// all load lazily; the shelves' first cards are the eager ones.
async function AllVideosGrid({
  profileId,
  feed,
}: {
  profileId: string;
  feed: KidsFeedParams;
}) {
  const rows = await getKidsVideos(profileId, {
    sort: feed.sort,
    dir: feed.dir,
    type: feed.type,
    maxLen: feed.maxLen,
  });
  // Playlists snapshot — feeds the shared "Save to playlist" dialog
  // behind every video card's ⋮ menu. cache() makes this the same query
  // the shelves already ran this request.
  const playlistRows = await getPlaylists(profileId);

  return (
    <>
      <FeedHeader
        title={feed.type === "shorts" ? "All shorts" : "All videos"}
        actions={<KidsSortChips options={sortOptions(profileId, feed)} />}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={
            feed.type === "shorts" ? (
              <KIDS_VIEWS.shorts.icon size={48} weight="fill" />
            ) : (
              <Play size={48} weight="fill" />
            )
          }
          message={
            feed.type === "shorts"
              ? "No shorts yet!"
              : feed.type === "videos"
                ? "No videos yet!"
                : feed.maxLen !== null
                  ? `No videos under ${maxLenLabel(feed.maxLen)} yet!`
                  : "Ask a grown-up to pick some videos!"
          }
          action={
            feed.type !== "all" || feed.maxLen !== null
              ? {
                  label: "Show everything",
                  href: kidsPortalUrl(profileId, feed, {
                    type: "all",
                    maxLen: null,
                  }),
                }
              : undefined
          }
        />
      ) : (
        <SaveToPlaylistProvider
          profileId={profileId}
          playlists={playlistRows}
        >
          <KidsVideoGrid
            rows={rows}
            profileId={profileId}
            feedQuery={kidsFeedQuery(feed)}
            eagerCount={0}
          />
        </SaveToPlaylistProvider>
      )}
    </>
  );
}
