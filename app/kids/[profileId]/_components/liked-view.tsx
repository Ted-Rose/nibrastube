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
  kidsPortalUrl,
  lenRangeLabel,
  type KidsFeedParams,
} from "@/lib/kids-feed";
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
        <EmptyState
          icon={<ViewIcon size={48} weight="fill" />}
          message={
            query
              ? feed.type === "shorts"
                ? "No shorts found!"
                : "No videos found!"
              : feed.type === "shorts"
                ? "No liked shorts yet!"
                : feed.type === "videos"
                  ? "No liked videos yet!"
                  : feed.minLen !== null || feed.maxLen !== null
                    ? `No liked videos ${lenRangeLabel(feed.minLen, feed.maxLen)} yet!`
                    : "No liked videos yet! Tap the 👍 while watching."
          }
          action={
            query
              ? {
                  label: "Clear search",
                  href: kidsPortalUrl(profileId, feed, { q: "" }),
                }
              : feed.type !== "all" ||
                  feed.minLen !== null ||
                  feed.maxLen !== null
                ? {
                    label: "Show everything",
                    href: kidsPortalUrl(profileId, feed, {
                      type: "all",
                      minLen: null,
                      maxLen: null,
                    }),
                  }
                : {
                    label: "Find videos",
                    href: kidsPortalUrl(profileId, feed, {
                      view: "videos",
                      channel: null,
                    }),
                  }
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
          />
        </SaveToPlaylistProvider>
      )}
    </>
  );
}
