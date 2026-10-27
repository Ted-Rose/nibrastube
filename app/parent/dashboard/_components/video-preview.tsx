import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { Prohibit, X } from "@phosphor-icons/react/dist/ssr";
import { db } from "@/lib/db";
import { videos, whitelistedVideos } from "@/lib/db/schema";
import {
  getVideoDetails,
  toDashboardVideo,
  type DashboardVideo,
} from "@/lib/youtube";
import { upsertVideoRows } from "@/lib/video-cache";
import { cn } from "@/lib/utils";
import { VideoPreviewOverlay } from "@/components/video-preview-overlay";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Async wrapper for the ?video= preview overlay (mirrors
// app/songs/_components/song-overlay.tsx): resolves the video through
// the `videos` cache, hydrating via videos.list when missing/stale —
// which also warms the cache so a subsequent pinVideo skips its own
// fetch. Crafted/!unplayable ids render a notice card, never a 404:
// an age-restricted or non-embeddable video could never play for kids
// anyway, so there's nothing to vet.
export async function VideoPreview({
  videoId,
  profileId,
  profileName,
  closeHref,
}: {
  videoId: string;
  profileId: string;
  profileName: string;
  closeHref: string;
}) {
  let video: DashboardVideo | null = null;
  let notice: string | null = null;

  const row = await db.query.videos.findFirst({
    where: eq(videos.id, videoId),
  });
  if (row?.fetchedAt) {
    video = {
      id: row.id,
      title: row.title,
      thumbnail: row.thumbnail,
      channelTitle: row.channelTitle,
      channelId: row.channelId ?? undefined,
      publishedAt: row.publishedAt,
      durationSeconds: row.durationSeconds,
      isShort: row.isShort,
      viewCount: row.viewCount,
      ageRestricted: row.ageRestricted,
    };
    if (row.embeddable === false) {
      notice =
        "YouTube doesn't allow this video to play inside other " +
        "sites, so it can't be previewed here.";
    }
  } else {
    try {
      const details = await getVideoDetails(videoId);
      await upsertVideoRows([details]);
      video = toDashboardVideo(details);
      if (!details.embeddable) {
        notice =
          "YouTube doesn't allow this video to play inside other " +
          "sites, so it can't be previewed here.";
      }
    } catch {
      // Video deleted/private upstream, or the API/quota failed.
      notice =
        "This video couldn't be found on YouTube — it may have " +
        "been removed or made private.";
    }
  }

  if (video?.ageRestricted === true) {
    notice =
      "YouTube marks this video 18+, so it can never play for " +
      "kids — there's nothing to vet.";
  }

  if (!video || notice) {
    return (
      <div
        className={cn(
          "fixed inset-0 z-50 p-4 bg-black/70",
          "flex items-center justify-center"
        )}
      >
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Prohibit size={20} className="text-destructive" />
              Can&apos;t preview this video
            </CardTitle>
            <CardDescription>
              {notice ??
                "This video couldn't be found on YouTube — it may " +
                  "have been removed or made private."}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Link href={closeHref} scroll={false} className="w-full">
              <Button variant="outline" className="w-full">
                <X size={18} className="mr-2" /> Close
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const pinned = await db.query.whitelistedVideos.findFirst({
    where: and(
      eq(whitelistedVideos.profileId, profileId),
      eq(whitelistedVideos.videoId, videoId)
    ),
    columns: { videoId: true },
  });

  return (
    <VideoPreviewOverlay
      key={video.id}
      video={video}
      pinned={!!pinned}
      profileId={profileId}
      profileName={profileName}
      closeHref={closeHref}
    />
  );
}
