import type { SongsFeedParams } from "@/lib/songs-feed";
import { CompilationsView } from "./compilations-view";
import { LikedView } from "./liked-view";
import { SongsView } from "./songs-view";

// Everything below the tab strip fetches catalog rows and streams in
// under the page's Suspense boundary, so the header paints while the
// (remote) DB work is still in flight. Each view fetches its own data.
export function FeedContent({
  feed,
  userId,
  hasSession,
  profileId,
}: {
  feed: SongsFeedParams;
  // session.user.id, or null for anonymous visitors, kid-locked
  // devices, and kid sessions.
  userId: string | null;
  // Any signed-in session — suppresses the "Sign up free" CTAs that
  // only bounce a kid session back to its feed.
  hasSession: boolean;
  // The reacting profile — kid session's own, or the kid-lock cookie;
  // null for anonymous visitors and lockless parents.
  profileId: string | null;
}) {
  if (feed.view === "compilations") {
    return <CompilationsView feed={feed} />;
  }
  // The parser only lets "liked" survive when a profile resolved, so
  // profileId is non-null here — the guard is for the type, not a
  // reachable state.
  if (feed.view === "liked" && profileId) {
    return (
      <LikedView feed={feed} userId={userId} profileId={profileId} />
    );
  }
  // "songs" (including the ?video= compilation drill-in) and the
  // signed-in "mine" both render the song grid.
  return (
    <SongsView
      feed={feed}
      userId={userId}
      hasSession={hasSession}
      profileId={profileId}
    />
  );
}
