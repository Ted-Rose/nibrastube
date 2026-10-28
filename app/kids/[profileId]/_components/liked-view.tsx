import Link from "next/link";
import { House } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/empty-state";
import { KidsLengthFilter } from "@/components/kids-length-filter";
import { KidsTypeFilter } from "@/components/kids-type-filter";
import { KidsVideoGrid } from "@/components/kids-video-grid";
import { LinkPendingSpinner } from "@/components/link-pending-spinner";
import { SaveToPlaylistProvider } from "@/components/save-to-playlist-dialog";
import {
  getLikedVideos,
  getPlaylists,
  kidsFeedQuery,
  type KidsFeedParams,
} from "@/lib/kids-feed";
import { emptyStateFor } from "@/lib/empty-state";
import { FeedHeader } from "@/components/feed-header";
import { feedTitle, KIDS_VIEWS } from "./view-config";

// Liked tab — videos the kid tapped 👍 on, newest reaction first.
export async function LikedView({
  profileId,
  feed,
}: {
  profileId: string;
  feed: KidsFeedParams;
}) {
  const { q: query } = feed;

  const rows = await getLikedVideos(profileId, {
    q: query,
    type: feed.type,
    minLen: feed.minLen,
    maxLen: feed.maxLen,
  });
  // Playlists snapshot — feeds the shared "Save to playlist" dialog
  // behind every video card's ⋮ menu.
  const playlistRows = await getPlaylists(profileId);
  const ViewIcon = KIDS_VIEWS.liked.icon;

  const empty = emptyStateFor({
    feed,
    profileId,
    icon: ViewIcon,
    noun: feed.type === "shorts" ? "shorts" : "videos",
    filtered: [
      { type: "shorts", message: "No liked shorts yet!" },
      { type: "videos", message: "No liked videos yet!" },
      {
        type: "band",
        message: (l) => `No liked videos ${l} yet!`,
      },
    ],
    empty: {
      message: "No liked videos yet! Tap the 👍 while watching.",
      action: {
        label: "Find videos",
        overrides: { view: "videos", channel: null },
      },
    },
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
            <Link
              href={`/kids/${profileId}`}
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-lg font-black text-white shadow-md transition-transform hover:scale-105"
            >
              <House size={20} weight="fill" />
              Home
              <LinkPendingSpinner size={20} weight="bold" />
            </Link>
          </div>
        }
      />

      {rows.length === 0 ? (
        <EmptyState {...empty} />
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
