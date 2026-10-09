import { redirect } from "next/navigation";
import { KidsTileCard } from "@/components/kids-tile-card";
import { NewPlaylistButton } from "@/components/new-playlist-button";
import {
  getPlaylists,
  getPlaylistVideos,
  kidsPortalUrl,
  type KidsFeedParams,
} from "@/lib/kids-feed";
import { FeedHeader } from "./feed-header";
import { PlaylistDetailView } from "./playlist-detail-view";
import { feedTitle } from "./view-config";

// Playlists tab — the tile grid of a profile's playlists, or the opened
// playlist when ?list= is set.
export async function PlaylistsView({
  profileId,
  feed,
}: {
  profileId: string;
  feed: KidsFeedParams;
}) {
  const { q: query, list } = feed;
  const inPlaylist = list !== null;

  const rows = inPlaylist
    ? await getPlaylistVideos(profileId, list, { q: query })
    : [];
  // Playlists snapshot — feeds both playlists views and the shared
  // "Save to playlist" dialog behind every video card's ⋮ menu.
  const playlistRows = await getPlaylists(profileId);

  const playlist = inPlaylist
    ? (playlistRows.find((p) => p.id === list) ?? null)
    : null;
  if (inPlaylist && !playlist) {
    // Deleted or another profile's playlist id — drop back to the list.
    redirect(kidsPortalUrl(profileId, feed, { list: null }));
  }

  if (playlist) {
    return (
      <PlaylistDetailView
        profileId={profileId}
        feed={feed}
        playlist={playlist}
        playlistRows={playlistRows}
        rows={rows}
      />
    );
  }

  // Search on the playlists tab filters playlist cards by name.
  const needle = query.toLowerCase();
  const visiblePlaylists = playlistRows.filter(
    (p) => !needle || p.name.toLowerCase().includes(needle)
  );

  return (
    <>
      <FeedHeader title={feedTitle(feed)} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
        {visiblePlaylists.map((p) => (
          <KidsTileCard
            key={p.id}
            variant="cover"
            href={kidsPortalUrl(profileId, feed, { list: p.id })}
            title={p.name}
            count={p.videoCount}
            thumbnail={p.coverThumbnail}
          />
        ))}
        <NewPlaylistButton profileId={profileId} />
      </div>
    </>
  );
}
