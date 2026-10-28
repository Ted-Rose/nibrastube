import { and, count, desc, eq, isNull } from "drizzle-orm";
import { PushPin } from "@phosphor-icons/react/dist/ssr";
import { db } from "@/lib/db";
import { videos, whitelistedVideos } from "@/lib/db/schema";
import { refreshStaleVideos } from "@/app/actions/refresh";
import { PinnedVideosPanel } from "@/components/pinned-videos-panel";
import { SubmitButton } from "@/components/submit-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Streams in under its own Suspense boundary: fetching slim columns only
// (the videos.raw JSONB alone is ~9KB/row) keeps this to a few hundred ms
// even for profiles with ~2k pins.
export async function PinnedVideosCard({
  profileId,
  profileName,
  returnTo,
  refreshed,
  removed,
}: {
  profileId: string;
  profileName: string;
  returnTo: string;
  refreshed: number | null;
  removed: number;
}) {
  const [pinnedVideos, [stale]] = await Promise.all([
    db
      .select({
        id: videos.id,
        title: videos.title,
        thumbnail: videos.thumbnail,
        // Drives the "Blocked" label — a pinned age-restricted video is
        // inert on kids surfaces (the `suitableVideo` query guard), so
        // hiding it here would repeat the invisible-pin UX bug.
        ageRestricted: videos.ageRestricted,
      })
      .from(whitelistedVideos)
      .innerJoin(videos, eq(whitelistedVideos.videoId, videos.id))
      .where(eq(whitelistedVideos.profileId, profileId))
      .orderBy(desc(whitelistedVideos.pinnedAt)),
    // Whitelisted videos cached before the rich-metadata columns existed
    // — refreshable via the button below.
    db
      .select({ n: count() })
      .from(whitelistedVideos)
      .innerJoin(videos, eq(whitelistedVideos.videoId, videos.id))
      .where(
        and(
          eq(whitelistedVideos.profileId, profileId),
          isNull(videos.fetchedAt)
        )
      ),
  ]);
  const staleCount = stale?.n ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center">
          <PushPin size={20} className="mr-2 text-primary" /> Approved Videos
        </CardTitle>
        <CardDescription>
          {pinnedVideos.length} approved for {profileName}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {refreshed !== null && (
          <p className="px-6 pb-4 text-xs text-muted-foreground">
            Refreshed details for {refreshed} video
            {refreshed === 1 ? "" : "s"}.
            {removed > 0 &&
              ` Removed ${removed} no longer playable on YouTube.`}
          </p>
        )}
        <div className="max-h-[400px] overflow-y-auto px-6">
          {pinnedVideos.length === 0 && (
            <p className="text-sm text-muted-foreground italic">
              No videos approved yet.
            </p>
          )}
          <PinnedVideosPanel videos={pinnedVideos} profileId={profileId} />
        </div>
      </CardContent>
      {staleCount > 0 && (
        <CardFooter className="px-6 pt-0">
          <form
            action={refreshStaleVideos.bind(null, profileId)}
            className="w-full"
          >
            <input type="hidden" name="returnTo" value={returnTo} />
            <SubmitButton
              variant="outline"
              size="touch"
              pendingLabel="Refreshing…"
              className="w-full"
            >
              Refresh {staleCount} video{staleCount === 1 ? "" : "s"} missing
              details
            </SubmitButton>
          </form>
        </CardFooter>
      )}
    </Card>
  );
}
