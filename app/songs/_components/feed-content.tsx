import type { SongsFeedParams } from "@/lib/songs-feed";
import { CompilationsView } from "./compilations-view";
import { SongsView } from "./songs-view";

// Everything below the tab strip fetches catalog rows and streams in
// under the page's Suspense boundary, so the header paints while the
// (remote) DB work is still in flight. Each view fetches its own data.
export function FeedContent({
  feed,
  userId,
}: {
  feed: SongsFeedParams;
  // session.user.id, or null for anonymous visitors, kid-locked
  // devices, and kid sessions.
  userId: string | null;
}) {
  if (feed.view === "compilations") {
    return <CompilationsView feed={feed} />;
  }
  // "songs" (including the ?video= compilation drill-in) and the
  // signed-in "mine" both render the song grid.
  return <SongsView feed={feed} userId={userId} />;
}
