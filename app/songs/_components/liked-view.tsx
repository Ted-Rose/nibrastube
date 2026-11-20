import {
  getLikedSongs,
  songsCatalogUrl,
  type SongsFeedParams,
} from "@/lib/songs-feed";
import { EmptyState } from "@/components/empty-state";
import { FeedHeader } from "@/components/feed-header";
import { KidsSortChips } from "@/components/kids-sort-chips";
import { SongCatalogGrid } from "@/components/song-catalog-grid";
import { feedTitle, sortOptions, SONGS_VIEWS } from "./view-config";

// The Liked tab — songs the profile tapped 👍 on in the ?song=
// player, newest reaction first. Only rendered when a kid profile
// resolved (kid session or lock cookie); cards play through the same
// overlay, whose queue is the liked list itself.
export async function LikedView({
  feed,
  userId,
  profileId,
}: {
  feed: SongsFeedParams;
  userId: string | null;
  profileId: string;
}) {
  const rows = await getLikedSongs(
    profileId,
    feed,
    userId ?? undefined
  );
  const EmptyIcon = SONGS_VIEWS.liked.icon;

  return (
    <>
      <FeedHeader
        title={feedTitle(feed)}
        actions={<KidsSortChips options={sortOptions(feed)} />}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<EmptyIcon size={48} weight="fill" />}
          message={
            feed.q
              ? "No songs found!"
              : "No liked songs yet! Tap the thumbs up while a song plays."
          }
          action={
            feed.q
              ? {
                  label: "Clear search",
                  href: songsCatalogUrl(feed, { q: "" }),
                }
              : {
                  label: "Browse songs",
                  href: songsCatalogUrl(feed, { view: "songs" }),
                }
          }
        />
      ) : (
        <SongCatalogGrid rows={rows} playerBase={songsCatalogUrl(feed)} />
      )}
    </>
  );
}
