import { and, eq } from "drizzle-orm";
import {
  Check,
  Users,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { db } from "@/lib/db";
import {
  whitelistedChannels,
  whitelistedVideos,
} from "@/lib/db/schema";
import {
  getChannelDetails,
  getUploadsPage,
  getVideosBatch,
  toDashboardVideo,
  type ChannelDetails,
  type DashboardVideo,
} from "@/lib/youtube";
import { upsertVideoRows } from "@/lib/video-cache";
import { approveChannel } from "@/app/actions/channels";
import { loadChannelUploads } from "@/app/actions/channel-videos";
import { BackLink } from "@/components/back-link";
import { ChannelUploadsList } from "@/components/channel-uploads-list";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

const compact = (n: number) =>
  Intl.NumberFormat("en", { notation: "compact" }).format(n);

const QUOTA_MESSAGE =
  "Couldn't load this channel right now — the YouTube API quota " +
  "may be reached. Try again later.";
const NOT_FOUND_MESSAGE =
  "This channel couldn't be found on YouTube — it may have been " +
  "removed or renamed.";
const UPLOADS_QUOTA_MESSAGE =
  "Couldn't load this channel's uploads — the YouTube API quota " +
  "may be reached. Try again later.";

function ChannelNotice({
  href,
  message,
}: {
  href: string;
  message: string;
}) {
  return (
    <>
      <BackLink href={href}>All channels</BackLink>
      <Card>
        <CardContent
          className={cn(
            "flex flex-col items-center gap-3 py-12 text-center"
          )}
        >
          <WarningCircle
            size={40}
            className="text-muted-foreground"
          />
          <p className="max-w-md text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    </>
  );
}

// The ?channel= drill-in: channel header (avatar, description, stats,
// approve CTA) plus a paginated grid of its uploads — the parent
// vetting surface for "approve channel vs pin individual videos".
// Made-for-kids videos are SHOWN here deliberately (the MFK gate is
// for unvetted surfaces only); age-restricted rows show a "Blocked"
// badge with the pin disabled — a cluster of them is exactly the
// vetting signal a parent needs.
export async function ChannelDetail({
  channelId,
  profileId,
  profileName,
  allChannelsHref,
  previewBaseHref,
}: {
  channelId: string;
  profileId: string;
  profileName: string;
  // dashboardUrl without &channel= — the "All channels" exit keeps q.
  allChannelsHref: string;
  // dashboardUrl WITH &channel= — upload cards append &video= so the
  // preview overlay opens on top of this drill-in.
  previewBaseHref: string;
}) {
  let details: ChannelDetails | null;
  try {
    details = await getChannelDetails(channelId);
  } catch {
    return (
      <ChannelNotice
        href={allChannelsHref}
        message={QUOTA_MESSAGE}
      />
    );
  }
  if (!details) {
    return (
      <ChannelNotice
        href={allChannelsHref}
        message={NOT_FOUND_MESSAGE}
      />
    );
  }

  // First uploads page: playlistItems (1 unit) -> videos.list hydrate
  // (embeddable only) -> warm the videos cache. Do NOT write the
  // channels row — approveChannel owns the registry.
  let uploads: DashboardVideo[] = [];
  let nextPageToken: string | null = null;
  let uploadsError = false;
  if (details.uploadsPlaylistId) {
    try {
      const page = await getUploadsPage(details.uploadsPlaylistId);
      const byId = new Map(
        (await getVideosBatch(page.videoIds)).map((v) => [v.id, v])
      );
      const hydrated = page.videoIds.flatMap((id) => {
        const v = byId.get(id);
        return v ? [v] : [];
      });
      await upsertVideoRows(hydrated);
      uploads = hydrated.map(toDashboardVideo);
      nextPageToken = page.nextPageToken ?? null;
    } catch {
      uploadsError = true;
    }
  }

  const [pinnedRelations, approvedRelation] = await Promise.all([
    db
      .select({ videoId: whitelistedVideos.videoId })
      .from(whitelistedVideos)
      .where(eq(whitelistedVideos.profileId, profileId)),
    db.query.whitelistedChannels.findFirst({
      where: and(
        eq(whitelistedChannels.profileId, profileId),
        eq(whitelistedChannels.channelId, channelId)
      ),
      columns: { channelId: true },
    }),
  ]);
  const pinnedIds = new Set(pinnedRelations.map((r) => r.videoId));
  const approved = !!approvedRelation;

  const stats = [
    details.subscriberCount != null &&
      `${compact(details.subscriberCount)} subscribers`,
    details.videoCount != null &&
      `${compact(details.videoCount)} videos`,
    details.country,
    details.publishedAt &&
      `Joined ${details.publishedAt.toLocaleDateString()}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <BackLink href={allChannelsHref}>All channels</BackLink>

      <Card className="mb-8 overflow-hidden">
        <CardHeader className="p-4 sm:p-6">
          <div className="flex flex-wrap items-start gap-4">
            {details.thumbnail ? (
              <img
                src={details.thumbnail}
                className={cn(
                  "h-20 w-20 shrink-0 rounded-full object-cover",
                  "shadow-sm"
                )}
                alt={details.title}
              />
            ) : (
              <div
                className={cn(
                  "flex h-20 w-20 shrink-0 items-center",
                  "justify-center rounded-full bg-muted",
                  "text-muted-foreground"
                )}
              >
                <Users size={32} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <CardTitle className="text-xl leading-snug">
                {details.title}
              </CardTitle>
              {stats && (
                <CardDescription className="mt-1">
                  {stats}
                </CardDescription>
              )}
              {details.description && (
                <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                  {details.description}
                </p>
              )}
              <a
                href={`https://youtube.com/channel/${details.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "mt-2 inline-block text-xs font-medium",
                  "text-muted-foreground underline-offset-4",
                  "hover:text-foreground hover:underline"
                )}
              >
                Open on YouTube
              </a>
            </div>
            <div className="w-full sm:w-56">
              {approved ? (
                <Button
                  disabled
                  className={cn(
                    "w-full bg-green-100 text-green-700",
                    "border-green-200 hover:bg-green-100"
                  )}
                >
                  <Check size={18} className="mr-2" /> Approved
                </Button>
              ) : (
                <form
                  action={approveChannel.bind(
                    null,
                    profileId,
                    channelId
                  )}
                >
                  <SubmitButton
                    size="touch"
                    pendingLabel="Approving…"
                    className="w-full"
                  >
                    Approve channel for {profileName}
                  </SubmitButton>
                </form>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">Uploads</h2>
        <p className="text-xs text-muted-foreground">
          Showing playable videos.
        </p>
      </div>
      {uploadsError ? (
        <ChannelNotice
          href={allChannelsHref}
          message={UPLOADS_QUOTA_MESSAGE}
        />
      ) : uploads.length === 0 && nextPageToken == null ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground italic">
              No playable uploads on this channel yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ChannelUploadsList
          initialItems={uploads}
          initialFlaggedIds={uploads
            .map((v) => v.id)
            .filter((id) => pinnedIds.has(id))}
          initialNextPageToken={nextPageToken}
          profileId={profileId}
          profileName={profileName}
          previewBaseHref={previewBaseHref}
          loadMore={
            nextPageToken
              ? loadChannelUploads.bind(null, profileId, channelId)
              : undefined
          }
        />
      )}
    </>
  );
}
