import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { WatchExperience } from "@/components/watch-experience";
import {
  getKidsVideos,
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

  // 1. Verify profile and video approval
  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, profileId),
  });

  if (!profile) notFound();

  // Autoplay playlist mirrors the grid the kid came from: same channel
  // filter, search, and sort.
  const feed = parseKidsFeedParams(await searchParams);
  let rows = await getKidsVideos(profileId, {
    q: feed.q,
    channelId: feed.channel,
    sort: feed.sort,
    dir: feed.dir,
  });
  let currentIndex = rows.findIndex((r) => r.video.id === videoId);

  if (currentIndex === -1) {
    // Stale link from a filtered view — fall back to the full list (still
    // sorted) instead of bouncing the kid out.
    rows = await getKidsVideos(profileId, { sort: feed.sort, dir: feed.dir });
    currentIndex = rows.findIndex((r) => r.video.id === videoId);
  }

  if (currentIndex === -1) {
    // If not approved, redirect back to the portal
    redirect(`/kids/${profileId}`);
  }

  const playlist = rows.map(({ video, progress }) => {
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
    />
  );
}
