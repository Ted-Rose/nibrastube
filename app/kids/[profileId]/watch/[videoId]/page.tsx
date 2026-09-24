import { db } from "@/lib/db";
import { videos, profiles, whitelistedVideos, watchProgress } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { WatchExperience } from "@/components/watch-experience";

interface WatchPageProps {
  params: Promise<{ profileId: string; videoId: string }>;
}

export default async function WatchPage({ params }: WatchPageProps) {
  const { profileId, videoId } = await params;

  // 1. Verify profile and video approval
  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, profileId),
  });

  if (!profile) notFound();

  // Playlist + watch progress in one joined round trip
  const rows = await db
    .select({ video: videos, progress: watchProgress })
    .from(whitelistedVideos)
    .innerJoin(videos, eq(videos.id, whitelistedVideos.videoId))
    .leftJoin(
      watchProgress,
      and(
        eq(watchProgress.profileId, whitelistedVideos.profileId),
        eq(watchProgress.videoId, whitelistedVideos.videoId)
      )
    )
    .where(eq(whitelistedVideos.profileId, profileId))
    .orderBy(asc(whitelistedVideos.pinnedAt));

  const currentIndex = rows.findIndex((r) => r.video.id === videoId);

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
    return { id: video.id, title: video.title, startSeconds };
  });

  return (
    <WatchExperience
      profileId={profileId}
      profileName={profile.name}
      profileAvatar={profile.avatar}
      playlist={playlist}
      startIndex={currentIndex}
    />
  );
}
