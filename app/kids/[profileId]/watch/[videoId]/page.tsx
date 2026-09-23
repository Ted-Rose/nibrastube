import { db } from "@/lib/db";
import { videos, profiles, whitelistedVideos } from "@/lib/db/schema";
import { eq, asc, inArray } from "drizzle-orm";
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

  const approved = await db.query.whitelistedVideos.findMany({
    where: eq(whitelistedVideos.profileId, profileId),
    orderBy: asc(whitelistedVideos.pinnedAt),
  });

  const currentIndex = approved.findIndex((r) => r.videoId === videoId);

  if (currentIndex === -1) {
    // If not approved, redirect back to the portal
    redirect(`/kids/${profileId}`);
  }

  const videoRows = await db.query.videos.findMany({
    where: inArray(
      videos.id,
      approved.map((r) => r.videoId)
    ),
  });
  const titleById = new Map(videoRows.map((v) => [v.id, v.title]));

  const playlist = approved.map((r) => ({
    id: r.videoId,
    title: titleById.get(r.videoId) ?? "",
  }));

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
