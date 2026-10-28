import { EmptyState } from "@/components/empty-state";
import { KidsLengthFilter } from "@/components/kids-length-filter";
import { KidsTileCard } from "@/components/kids-tile-card";
import { KidsTypeFilter } from "@/components/kids-type-filter";
import {
  getKidsChannels,
  kidsPortalUrl,
  type KidsFeedParams,
} from "@/lib/kids-feed";
import { emptyStateFor } from "@/lib/empty-state";
import { FeedHeader } from "@/components/feed-header";
import { feedTitle, KIDS_VIEWS } from "./view-config";

// Channels tab — one tile per approved channel (including mid-backfill
// channels with no videos yet). The ?type=/?max= filters narrow tiles
// to channels that actually have matching videos and carry into the
// drill-in's video grid.
export async function ChannelsView({
  profileId,
  feed,
}: {
  profileId: string;
  feed: KidsFeedParams;
}) {
  const { q: query } = feed;
  const channelRows = await getKidsChannels(profileId, {
    q: query,
    type: feed.type,
    minLen: feed.minLen,
    maxLen: feed.maxLen,
  });
  const ViewIcon = KIDS_VIEWS.channels.icon;

  const empty = emptyStateFor({
    feed,
    profileId,
    icon: ViewIcon,
    noun: "channels",
    filtered: [
      { type: "shorts", message: "No channels with shorts yet!" },
      { type: "videos", message: "No channels with videos yet!" },
      {
        type: "band",
        message: (l) => `No channels with videos ${l} yet!`,
      },
    ],
    empty: { message: "Ask a grown-up to approve some channels!" },
  });

  return (
    <>
      <FeedHeader
        title={feedTitle(feed)}
        actions={
          <div
            data-drag-scroll
            className="flex max-w-full flex-nowrap items-center gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <KidsTypeFilter profileId={profileId} feed={feed} />
            <KidsLengthFilter minLen={feed.minLen} maxLen={feed.maxLen} />
          </div>
        }
      />

      {channelRows.length === 0 ? (
        <EmptyState {...empty} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {channelRows.map((c) => (
            <KidsTileCard
              key={c.id}
              variant="avatar"
              href={kidsPortalUrl(profileId, feed, { channel: c.id })}
              title={c.title}
              count={c.videoCount}
              noun={feed.type === "shorts" ? "short" : "video"}
              thumbnail={c.thumbnail}
            />
          ))}
        </div>
      )}
    </>
  );
}
