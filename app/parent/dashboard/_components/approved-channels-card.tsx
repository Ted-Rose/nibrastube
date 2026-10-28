import { and, count, eq, isNotNull } from "drizzle-orm";
import {
  Check,
  Pause,
  Play,
  SpinnerGap,
  Trash,
  Video,
} from "@phosphor-icons/react/dist/ssr";
import { db } from "@/lib/db";
import {
  channels,
  channelSyncExclusions,
  profiles,
  whitelistedChannels,
  whitelistedVideos,
} from "@/lib/db/schema";
import {
  setChannelSyncExcluded,
  unapproveChannel,
} from "@/app/actions/channels";
import { SubmitButton } from "@/components/submit-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export async function ApprovedChannelsCard({
  profileId,
  profileName,
}: {
  profileId: string;
  profileName: string;
}) {
  const [approvedChannels, channelPinCounts, syncExclusions] =
    await Promise.all([
      db
        .select({ whitelist: whitelistedChannels, channel: channels })
        .from(whitelistedChannels)
        .innerJoin(channels, eq(whitelistedChannels.channelId, channels.id))
        .where(eq(whitelistedChannels.profileId, profileId)),
      db
        .select({ channelId: whitelistedVideos.viaChannelId, total: count() })
        .from(whitelistedVideos)
        .where(
          and(
            eq(whitelistedVideos.profileId, profileId),
            isNotNull(whitelistedVideos.viaChannelId)
          )
        )
        .groupBy(whitelistedVideos.viaChannelId),
      // Exclusions are keyed by the profile's owner, not the viewing
      // parent, so shared-access profiles show the owner's pause state.
      db
        .select({ channelId: channelSyncExclusions.channelId })
        .from(channelSyncExclusions)
        .innerJoin(
          profiles,
          eq(channelSyncExclusions.parentId, profiles.parentId)
        )
        .where(eq(profiles.id, profileId)),
    ]);
  const pinCountByChannel = new Map(
    channelPinCounts.map((r) => [r.channelId, r.total])
  );
  const pausedChannelIds = new Set(
    syncExclusions.map((r) => r.channelId)
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center">
          <Check size={20} className="mr-2 text-primary" /> Approved Channels
        </CardTitle>
        <CardDescription>
          {approvedChannels.length} channels approved for {profileName}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <div className="max-h-[400px] overflow-y-auto px-6 space-y-4">
          {approvedChannels.length === 0 && (
            <p className="text-sm text-muted-foreground italic">
              No channels approved yet. Search for channels above.
            </p>
          )}
          {approvedChannels.map(({ whitelist, channel }) => {
            const paused = pausedChannelIds.has(channel.id);
            return (
            <div key={channel.id} className="flex gap-3 group items-center">
              {channel.thumbnail ? (
                <img
                  src={channel.thumbnail}
                  className={cn(
                    "w-10 h-10 object-cover rounded-full shadow-sm"
                  )}
                  alt=""
                />
              ) : (
                <div
                  className={cn(
                    "w-10 h-10 rounded-full bg-muted flex",
                    "items-center justify-center text-muted-foreground"
                  )}
                >
                  <Video size={18} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">
                  {channel.title}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {pinCountByChannel.get(channel.id) ?? 0} videos
                  {whitelist.lastSyncAt &&
                    ` · synced ${whitelist.lastSyncAt.toLocaleDateString()}`}
                </p>
                {paused ? (
                  <p className="text-[11px] text-amber-600">
                    Paused · sync paused for all profiles
                  </p>
                ) : (
                  !whitelist.backfillComplete && (
                    <p
                      className={cn(
                        "text-[11px] text-primary flex items-center",
                        "gap-1"
                      )}
                    >
                      <SpinnerGap size={12} className="animate-spin" />{" "}
                      Syncing…
                    </p>
                  )
                )}
              </div>
              <form
                action={setChannelSyncExcluded.bind(
                  null,
                  channel.id,
                  !paused
                )}
              >
                <SubmitButton
                  variant="ghost"
                  size="icon-touch"
                  aria-label={
                    paused
                      ? `Resume sync for ${channel.title}`
                      : `Pause sync for ${channel.title}`
                  }
                  className={cn(
                    "opacity-100 transition-opacity",
                    "md:opacity-0 md:group-hover:opacity-100"
                  )}
                >
                  {paused ? <Play size={20} /> : <Pause size={20} />}
                </SubmitButton>
              </form>
              <form
                action={unapproveChannel.bind(
                  null,
                  profileId,
                  channel.id
                )}
              >
                <SubmitButton
                  variant="ghost"
                  size="icon-touch"
                  aria-label={`Unapprove ${channel.title}`}
                  className={cn(
                    "text-destructive opacity-100 transition-opacity",
                    "md:opacity-0 md:group-hover:opacity-100"
                  )}
                >
                  <Trash size={20} />
                </SubmitButton>
              </form>
            </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
