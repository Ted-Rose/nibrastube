import { EmptyState } from "@/components/empty-state";
import { FeedHeader } from "@/components/feed-header";
import { KidsTileCard } from "@/components/kids-tile-card";
import {
  getCompilations,
  songsCatalogUrl,
  type SongsFeedParams,
} from "@/lib/songs-feed";
import { feedTitle, SONGS_VIEWS } from "./view-config";

// Compilations tab — one tile per video that has imported songs, each
// drilling into its song list via ?view=songs&video=<id>.
export async function CompilationsView({
  feed,
}: {
  feed: SongsFeedParams;
}) {
  const { q: query } = feed;
  const rows = await getCompilations({ q: query });
  const ViewIcon = SONGS_VIEWS.compilations.icon;

  return (
    <>
      <FeedHeader title={feedTitle(feed)} />

      {rows.length === 0 ? (
        <EmptyState
          icon={<ViewIcon size={48} weight="fill" />}
          message={
            query ? "No compilations found!" : "No compilations yet!"
          }
          action={
            query
              ? {
                  label: "Clear search",
                  href: songsCatalogUrl(feed, { q: "" }),
                }
              : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {rows.map((c) => (
            <KidsTileCard
              key={c.id}
              variant="cover"
              href={songsCatalogUrl(feed, {
                view: "songs",
                video: c.id,
              })}
              title={c.title}
              count={c.songCount}
              thumbnail={c.thumbnail}
              noun="song"
            />
          ))}
        </div>
      )}
    </>
  );
}
