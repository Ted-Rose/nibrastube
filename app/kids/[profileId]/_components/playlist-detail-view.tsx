import Link from "next/link";
import { Play, Playlist } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/empty-state";
import type { FeedRow } from "@/components/kids-video-grid";
import { KidsLengthFilter } from "@/components/kids-length-filter";
import { KidsTypeFilter } from "@/components/kids-type-filter";
import { LinkPendingSpinner } from "@/components/link-pending-spinner";
import { PlaylistActionsMenu } from "@/components/playlist-actions-menu";
import { PlaylistSortableList } from "@/components/playlist-sortable-list";
import { SaveToPlaylistProvider } from "@/components/save-to-playlist-dialog";
import {
  kidsFeedQuery,
  kidsPortalUrl,
  lenRangeLabel,
  type KidsFeedParams,
  type KidsPlaylist,
} from "@/lib/kids-feed";
import { BackLink } from "@/components/back-link";
import { FeedHeader } from "@/components/feed-header";
import { feedTitle } from "./view-config";

// One playlist opened from the Playlists tab — kid-ordered rows with the
// ⋮ actions menu and a "Play all" shortcut in the header.
export function PlaylistDetailView({
  profileId,
  feed,
  playlist,
  playlistRows,
  rows,
}: {
  profileId: string;
  feed: KidsFeedParams;
  playlist: KidsPlaylist;
  playlistRows: KidsPlaylist[];
  rows: FeedRow[];
}) {
  const { q: query } = feed;
  const emptyAction = query
    ? {
        label: "Clear search",
        href: kidsPortalUrl(profileId, feed, { q: "" }),
      }
    : feed.type !== "all" || feed.minLen !== null || feed.maxLen !== null
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
        };

  return (
    <>
      <BackLink href={kidsPortalUrl(profileId, feed, { list: null })}>
        All playlists
      </BackLink>

      <FeedHeader
        title={feedTitle(feed, { playlistName: playlist.name })}
        actions={
          <div
            data-drag-scroll
            className="flex max-w-full flex-nowrap items-center gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <KidsTypeFilter profileId={profileId} feed={feed} />
            <KidsLengthFilter minLen={feed.minLen} maxLen={feed.maxLen} />
            {rows.length > 0 && (
              <Link
                href={`/kids/${profileId}/watch/${rows[0].video.id}${kidsFeedQuery(feed)}`}
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-lg font-black text-white shadow-md transition-transform hover:scale-105"
              >
                <Play size={20} weight="fill" />
                Play all
                <LinkPendingSpinner size={20} weight="bold" />
              </Link>
            )}
            <PlaylistActionsMenu
              profileId={profileId}
              playlistId={playlist.id}
              name={playlist.name}
            />
          </div>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Playlist size={48} weight="fill" />}
          message={
            query
              ? feed.type === "shorts"
                ? "No shorts found!"
                : "No videos found!"
              : feed.type === "shorts"
                ? "No shorts in this playlist!"
                : feed.type === "videos"
                  ? "No videos in this playlist!"
                  : feed.minLen !== null || feed.maxLen !== null
                    ? `No videos ${lenRangeLabel(feed.minLen, feed.maxLen)} in this playlist!`
                    : "No videos yet! Tap ⋮ on a video to add it."
          }
          action={emptyAction}
        />
      ) : (
        <SaveToPlaylistProvider
          profileId={profileId}
          playlists={playlistRows}
        >
          <PlaylistSortableList
            profileId={profileId}
            playlistId={playlist.id}
            rows={rows}
            feedQuery={kidsFeedQuery(feed)}
          />
        </SaveToPlaylistProvider>
      )}
    </>
  );
}
