import { EmptyState } from "@/components/empty-state";
import { KidsTileCard } from "@/components/kids-tile-card";
import {
  getKidsChannels,
  kidsPortalUrl,
  type KidsFeedParams,
} from "@/lib/kids-feed";
import { FeedHeader } from "./feed-header";
import { feedTitle, KIDS_VIEWS } from "./view-config";

// Channels tab — one tile per approved channel (including mid-backfill
// channels with no videos yet).
export async function ChannelsView({
  profileId,
  feed,
}: {
  profileId: string;
  feed: KidsFeedParams;
}) {
  const { q: query } = feed;
  const channelRows = await getKidsChannels(profileId, { q: query });
  const ViewIcon = KIDS_VIEWS.channels.icon;

  return (
    <>
      <FeedHeader title={feedTitle(feed)} />

      {channelRows.length === 0 ? (
        <EmptyState
          icon={<ViewIcon size={48} weight="fill" />}
          message={
            query
              ? "No channels found!"
              : "Ask a grown-up to approve some channels!"
          }
          action={
            query
              ? {
                  label: "Clear search",
                  href: kidsPortalUrl(profileId, feed, { q: "" }),
                }
              : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {channelRows.map((c) => (
            <KidsTileCard
              key={c.id}
              variant="avatar"
              href={kidsPortalUrl(profileId, feed, { channel: c.id })}
              title={c.title}
              count={c.videoCount}
              thumbnail={c.thumbnail}
            />
          ))}
        </div>
      )}
    </>
  );
}
