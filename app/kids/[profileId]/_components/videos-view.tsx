import { and, eq } from "drizzle-orm";
import { Play } from "@phosphor-icons/react/dist/ssr";
import { db } from "@/lib/db";
import { channels, whitelistedChannels } from "@/lib/db/schema";
import {
  getKidsVideos,
  getPlaylists,
  kidsFeedQuery,
  kidsPortalUrl,
  type KidsFeedParams,
} from "@/lib/kids-feed";
import { EmptyState } from "@/components/empty-state";
import { KidsVideoGrid } from "@/components/kids-video-grid";
import { KidsSortSelect } from "@/components/kids-sort-select";
import { SaveToPlaylistProvider } from "@/components/save-to-playlist-dialog";
import { BackLink } from "./back-link";
import { FeedHeader } from "./feed-header";
import { feedTitle, KIDS_VIEWS } from "./view-config";

// The Videos tab and the channel drill-in (view=channels&channel=…) —
// both render the whitelisted-videos grid, the drill-in filtered to one
// channel with an "All channels" back link on top.
export async function VideosView({
  profileId,
  feed,
}: {
  profileId: string;
  feed: KidsFeedParams;
}) {
  const { channel, q: query } = feed;
  const drilledIn = feed.view === "channels" && channel !== null;

  const rows = await getKidsVideos(profileId, {
    q: query,
    channelId: channel,
    sort: feed.sort,
    dir: feed.dir,
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
  // icon is the videos icon (Play), not the channels one.
  const EmptyIcon =
    query && channel === null ? KIDS_VIEWS[feed.view].icon : Play;
  const emptyMessage = query
    ? "No videos found!"
    : channelApproved
      ? "Videos are on the way!"
      : "Ask a grown-up to pick some videos!";
  const emptyAction = query
    ? {
        label: "Clear search",
        href: kidsPortalUrl(profileId, feed, { q: "" }),
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
          <KidsSortSelect
            value={`${feed.sort}:${feed.dir}`}
            className="w-full sm:w-auto"
          />
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
