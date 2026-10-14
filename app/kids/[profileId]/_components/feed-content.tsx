import type { KidsFeedParams } from "@/lib/kids-feed";
import { ChannelsView } from "./channels-view";
import { ForYouView } from "./foryou-view";
import { HistoryFeedView } from "./history-feed-view";
import { LikedView } from "./liked-view";
import { PlaylistsView } from "./playlists-view";
import { VideosView } from "./videos-view";

// Everything below the view menu fetches feed rows and streams in under
// its own Suspense boundary, so header + picker paint while the (remote)
// DB work is still in flight. Each view fetches only its own data.
export function FeedContent({
  profileId,
  feed,
}: {
  profileId: string;
  feed: KidsFeedParams;
}) {
  // The channel drill-in renders the videos grid filtered to one channel.
  if (feed.view === "channels" && feed.channel !== null) {
    return <VideosView profileId={profileId} feed={feed} />;
  }
  switch (feed.view) {
    case "foryou":
      return <ForYouView profileId={profileId} feed={feed} />;
    case "channels":
      return <ChannelsView profileId={profileId} feed={feed} />;
    case "liked":
      return <LikedView profileId={profileId} feed={feed} />;
    case "playlists":
      return <PlaylistsView profileId={profileId} feed={feed} />;
    case "history":
      return <HistoryFeedView profileId={profileId} feed={feed} />;
    default:
      return <VideosView profileId={profileId} feed={feed} />;
  }
}
