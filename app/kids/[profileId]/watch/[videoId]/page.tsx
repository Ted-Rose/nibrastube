import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { canViewProfile } from "@/lib/profiles";
import { WatchExperience } from "@/components/watch-experience";
import {
  getKidsVideos,
  getLikedVideos,
  getPlaylistVideos,
  getRecommendedVideos,
  getWatchHistory,
  kidsFeedQuery,
  parseKidsFeedParams,
  watchStatus,
} from "@/lib/kids-feed";

interface WatchPageProps {
  params: Promise<{ profileId: string; videoId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function WatchPage({ params, searchParams }: WatchPageProps) {
  const { profileId, videoId } = await params;

  // 1. Access check first — kid-locked to this profile or a parent who
  //    owns/shares it — so 404-vs-redirect can't be used to probe whether
  //    a profile UUID exists.
  const session = await getSession();
  const activeProfileId = (await cookies()).get("activeProfileId")?.value;
  if (!(await canViewProfile(session, profileId, activeProfileId))) {
    redirect("/kids");
  }

  // 2. Verify profile and video approval
  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, profileId),
  });

  if (!profile) notFound();

  // Autoplay playlist mirrors the grid the kid came from: same channel
  // filter, search, sort, shorts/videos type, length cap — or the
  // kid-ordered playlist queue. The Shorts feed is intrinsically type
  // "shorts".
  const feed = parseKidsFeedParams(await searchParams);
  const type = feed.view === "shorts" ? ("shorts" as const) : feed.type;
  const minLen = feed.minLen;
  const maxLen = feed.maxLen;
  const playlistId = feed.view === "playlists" ? feed.list : null;
  const history = feed.view === "history";
  // getWatchHistory returns one row per (video, watched-on day), so a
  // video watched on several days appears several times and sequential
  // autoplay would replay it — keep only the first (most recent) row
  // per video.
  const uniqueByVideo = <T extends { video: { id: string } }>(list: T[]) => {
    const seen = new Set<string>();
    return list.filter((r) => {
      if (seen.has(r.video.id)) return false;
      seen.add(r.video.id);
      return true;
    });
  };
  // Playlist queues advance in playlist order, history in most-recent-first
  // order — not unwatched-first.
  let sequential = playlistId !== null || history;
  let rows = playlistId
    ? await getPlaylistVideos(profileId, playlistId, {
        q: feed.q,
        type,
        minLen,
        maxLen,
      })
    : history
      ? uniqueByVideo(
          await getWatchHistory(profileId, {
            q: feed.q,
            date: feed.date ?? undefined,
            type,
            minLen,
            maxLen,
          })
        )
      : feed.view === "foryou" || feed.view === "shorts"
        ? await getRecommendedVideos(profileId, {
            q: feed.q,
            type,
            minLen,
            maxLen,
          })
        : feed.view === "liked"
          ? await getLikedVideos(profileId, {
              q: feed.q,
              type,
              minLen,
              maxLen,
            })
          : await getKidsVideos(profileId, {
              q: feed.q,
              channelId: feed.channel,
              sort: feed.sort,
              dir: feed.dir,
              type,
              minLen,
              maxLen,
            });
  let currentIndex = rows.findIndex((r) => r.video.id === videoId);

  if (currentIndex === -1) {
    // Stale link from a filtered view — fall back to the full list (still
    // sorted) instead of bouncing the kid out.
    rows = playlistId
      ? await getPlaylistVideos(profileId, playlistId)
      : history
        ? uniqueByVideo(await getWatchHistory(profileId))
        : feed.view === "foryou"
          ? await getRecommendedVideos(profileId)
          : feed.view === "shorts"
            ? await getRecommendedVideos(profileId, { type: "shorts" })
            : feed.view === "liked"
              ? await getLikedVideos(profileId)
              : await getKidsVideos(profileId, {
                  sort: feed.sort,
                  dir: feed.dir,
                });
    currentIndex = rows.findIndex((r) => r.video.id === videoId);
  }

  if (
    currentIndex === -1 &&
    (playlistId || feed.view === "foryou" || feed.view === "shorts")
  ) {
    // The playlist was deleted or emptied mid-session, or the video
    // re-ranked below the For-You cap — degrade to the full approved
    // list rather than bouncing back to the portal.
    rows = await getKidsVideos(profileId, {
      sort: feed.sort,
      dir: feed.dir,
    });
    currentIndex = rows.findIndex((r) => r.video.id === videoId);
    sequential = false;
  }

  if (currentIndex === -1) {
    // If not approved, redirect back to the portal — keep the feed
    // context so a stale Liked-tab link returns to the Liked tab.
    // The feed queries also apply the `suitableVideo` 18+ floor, so an
    // age-restricted video lands here and stays unwatchable even when
    // a parent pinned it.
    redirect(`/kids/${profileId}${kidsFeedQuery(feed)}`);
  }

  const playlist = rows.map(({ video, progress, reaction }) => {
    const duration = video.durationSeconds ?? 0;
    const startSeconds =
      progress &&
      !progress.completed &&
      duration > 0 &&
      progress.positionSeconds < duration - 10
        ? progress.positionSeconds
        : 0; // completed or nearly-done videos restart at 0, like YouTube
    return {
      id: video.id,
      title: video.title,
      startSeconds,
      status: watchStatus(progress),
      reaction,
    };
  });

  return (
    <WatchExperience
      profileId={profileId}
      profileName={profile.name}
      profileAvatar={profile.avatar}
      playlist={playlist}
      startIndex={currentIndex}
      returnQuery={kidsFeedQuery(feed)}
      sequential={sequential}
      swipeEnabled={profile.swipeEnabled}
    />
  );
}
