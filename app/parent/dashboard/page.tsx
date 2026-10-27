import { Suspense } from "react";
import { db } from "@/lib/db";
import {
  channels,
  channelSyncExclusions,
  profiles,
  songs,
  users,
  videos,
  whitelistedChannels,
  whitelistedVideos,
} from "@/lib/db/schema";
import { getSession, parentSession } from "@/lib/auth";
import { getManageableProfiles } from "@/lib/profiles";
import { and, asc, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
  searchChannels,
  searchYouTube,
  toDashboardVideo,
} from "@/lib/youtube";
import {
  loadMoreSearchChannels,
  loadMoreSearchVideos,
} from "@/app/actions/search";
import { refreshStaleVideos } from "@/app/actions/refresh";
import {
  setChannelSyncExcluded,
  unapproveChannel,
} from "@/app/actions/channels";
import { SearchResultsGrid } from "@/components/search-results-grid";
import { ChannelDetail } from "./_components/channel-detail";
import { VideoPreview } from "./_components/video-preview";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { LinkPendingSpinner } from "@/components/link-pending-spinner";
import { DashboardSearch } from "@/components/dashboard-search";
import { SongImportForm } from "@/components/song-import-form";
import { PinnedVideosPanel } from "@/components/pinned-videos-panel";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Check,
  MusicNotes,
  Pause,
  Play,
  PushPin,
  SpinnerGap,
  Trash,
  Users,
  Video,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import DailySyncPing from "@/components/daily-sync-ping";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

interface DashboardProps {
  searchParams: Promise<{
    q?: string;
    profileId?: string;
    type?: string;
    refreshed?: string;
    removed?: string;
    songsVideo?: string;
    // Non-feed params: ?video= opens the preview overlay (composes with
    // everything), ?channel= drills into a channel (type=channels).
    video?: string;
    channel?: string;
  }>;
}

// Param validation — bad values render nothing, never a 404.
const VIDEO_ID_PARAM_RE = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_PARAM_RE = /^UC[\w-]{10,40}$/;

function SidebarCardFallback({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center">
          {icon} {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex justify-center py-8">
        <SpinnerGap size={24} className="animate-spin text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

function SearchResultsFallback() {
  return (
    <div
      className={cn(
        "flex items-center justify-center py-20",
        "text-muted-foreground"
      )}
    >
      <SpinnerGap size={32} className="animate-spin" />
    </div>
  );
}

// Streams in under its own Suspense boundary: fetching slim columns only
// (the videos.raw JSONB alone is ~9KB/row) keeps this to a few hundred ms
// even for profiles with ~2k pins.
async function PinnedVideosCard({
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

async function ApprovedChannelsCard({
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

// Songs are a global registry, not profile-scoped — this card takes no
// profileId. The imported list renders when importSongs redirects back
// with ?songsVideo=<id>.
async function SongImportCard({
  userId,
  songsVideo,
  returnTo,
}: {
  userId: string;
  songsVideo: string | undefined;
  returnTo: string;
}) {
  const [user, importedSongs] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { songCommenterHandle: true },
    }),
    songsVideo
      ? db
          .select()
          .from(songs)
          .where(eq(songs.videoId, songsVideo))
          .orderBy(asc(songs.startSeconds))
      : Promise.resolve([]),
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center">
          <MusicNotes size={20} className="mr-2 text-primary" /> Import Songs
        </CardTitle>
        <CardDescription>
          Turn a commenter&apos;s timestamped tracklist into songs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SongImportForm
          storedHandle={user?.songCommenterHandle ?? null}
          returnTo={returnTo}
        />
        {importedSongs.length > 0 && (
          <div className="border-t pt-3">
            <p className="pb-2 text-xs text-muted-foreground">
              {importedSongs.length} song
              {importedSongs.length === 1 ? "" : "s"}
              {importedSongs[0].sourceHandle &&
                ` from @${importedSongs[0].sourceHandle}`}
            </p>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
              {importedSongs.map((song) => (
                <li key={song.id}>
                  <span className="tabular-nums text-muted-foreground">
                    {formatDuration(song.startSeconds)}
                    {" – "}
                    {song.endSeconds !== null
                      ? formatDuration(song.endSeconds)
                      : "end"}
                  </span>{" "}
                  {song.title}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// YouTube search + the pinned/approved lookups the result buttons need all
// run here, inside Suspense — the page shell paints instantly and only this
// region waits on the YouTube API. The client grid owns accumulation from
// here on: "Show more" hits the paging actions one opaque token at a time
// (100 quota units per search page).
async function SearchResults({
  query,
  searchType,
  profileId,
  profileName,
  previewBaseHref,
  channelBaseHref,
}: {
  query: string;
  searchType: "videos" | "channels";
  profileId: string;
  profileName: string;
  previewBaseHref: string;
  channelBaseHref: string;
}) {
  // The paging actions clamp to 200 chars — page 1 must use the same
  // string or a longer query would silently change between pages.
  const clampedQuery = query.slice(0, 200);
  const [videoPage, channelPage, pinnedRelations, approvedRelations] =
    await Promise.all([
      searchType === "videos"
        ? searchYouTube(clampedQuery)
        : Promise.resolve(null),
      searchType === "channels"
        ? searchChannels(clampedQuery)
        : Promise.resolve(null),
      db
        .select({ videoId: whitelistedVideos.videoId })
        .from(whitelistedVideos)
        .where(eq(whitelistedVideos.profileId, profileId)),
      db
        .select({ channelId: whitelistedChannels.channelId })
        .from(whitelistedChannels)
        .where(eq(whitelistedChannels.profileId, profileId)),
    ]);
  const pinnedVideoIds = new Set(pinnedRelations.map((r) => r.videoId));
  const approvedChannelIds = new Set(
    approvedRelations.map((r) => r.channelId)
  );

  if (searchType === "channels") {
    const items = channelPage?.items ?? [];
    return (
      <SearchResultsGrid
        searchType="channels"
        initialItems={items}
        initialFlaggedIds={items
          .filter((c) => approvedChannelIds.has(c.id))
          .map((c) => c.id)}
        initialNextPageToken={channelPage?.nextPageToken ?? null}
        profileId={profileId}
        profileName={profileName}
        previewBaseHref={previewBaseHref}
        channelBaseHref={channelBaseHref}
        loadMore={
          channelPage?.nextPageToken
            ? loadMoreSearchChannels.bind(null, profileId, clampedQuery)
            : undefined
        }
      />
    );
  }

  const items = (videoPage?.items ?? []).map(toDashboardVideo);
  return (
    <SearchResultsGrid
      searchType="videos"
      initialItems={items}
      initialFlaggedIds={items
        .filter((v) => pinnedVideoIds.has(v.id))
        .map((v) => v.id)}
      initialNextPageToken={videoPage?.nextPageToken ?? null}
      profileId={profileId}
      profileName={profileName}
      previewBaseHref={previewBaseHref}
      channelBaseHref={channelBaseHref}
      loadMore={
        videoPage?.nextPageToken
          ? loadMoreSearchVideos.bind(null, profileId, clampedQuery)
          : undefined
      }
    />
  );
}

export default async function DashboardPage({ searchParams }: DashboardProps) {
  const session = await getSession();
  const user = parentSession(session);
  if (!user) redirect("/login");

  const {
    q,
    profileId,
    type,
    refreshed,
    removed,
    songsVideo,
    video,
    channel,
  } = await searchParams;
  const query = q || "";
  const searchType = type === "channels" ? "channels" : "videos";
  const selectedProfileId = profileId;

  // Non-feed params, validated — bad values are ignored (render
  // nothing), never 404. ?channel= only applies in the channels tab.
  const previewVideoId =
    video && VIDEO_ID_PARAM_RE.test(video) ? video : null;
  const drillChannelId =
    searchType === "channels" && channel && CHANNEL_ID_PARAM_RE.test(channel)
      ? channel
      : null;

  // Get all profiles this parent owns or has shared access to
  const parentProfiles = await getManageableProfiles(user.id);

  if (parentProfiles.length === 0) {
    redirect("/parent/profiles");
  }

  // Determine active profile — fall back to the first manageable profile
  // when profileId is missing or stale, otherwise a search would crash on
  // activeProfile!.id when binding pin/approve actions.
  const activeProfile =
    (selectedProfileId
      ? parentProfiles.find(p => p.id === selectedProfileId)
      : undefined) ?? parentProfiles[0];

  // Single dashboard URL builder so every link (type tabs, profile
  // picker, back link, card hrefs, overlay close) drops/keeps params
  // deliberately: `channel` only survives inside the channels tab —
  // switching to type=videos, changing q, or switching profile
  // naturally drops it since callers don't re-pass it. `video`
  // composes with everything (search results AND the drill-in).
  const dashboardUrl = ({
    profileId: profileParam,
    type: typeParam,
    channel: channelParam,
    video: videoParam,
  }: {
    profileId?: string;
    type?: "videos" | "channels";
    channel?: string | null;
    video?: string | null;
  } = {}): string => {
    const t = typeParam ?? searchType;
    const sp = new URLSearchParams();
    sp.set("profileId", profileParam ?? activeProfile.id);
    if (query) sp.set("q", query);
    sp.set("type", t);
    if (t === "channels" && channelParam) {
      sp.set("channel", channelParam);
    }
    if (videoParam) sp.set("video", videoParam);
    return `/parent/dashboard?${sp.toString()}`;
  };

  return (
    <div className="container mx-auto py-6 sm:py-10 px-4">
      <DailySyncPing />
      <div
        className={cn(
          "mb-6 sm:mb-10 flex flex-wrap items-start",
          "justify-between gap-4"
        )}
      >
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Parent Portal
          </h1>
          <p className="text-muted-foreground mt-1">
            Search and approve videos for your kids
          </p>
        </div>
        {/* The public song catalog — reachable without the parent
            lock, so a plain Link/Button suffices. */}
        <Link href="/songs">
          <Button variant="outline" size="touch">
            <MusicNotes size={20} className="mr-2" /> Song catalog
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar: Profile Selection & Pinned Videos — below the search
            on mobile so the page's primary action comes first */}
        <div className="order-2 lg:order-1 lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Select Kid</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {parentProfiles.map(p => (
                <Link
                  key={p.id}
                  href={dashboardUrl({ profileId: p.id })}
                >
                  <Button
                    variant={activeProfile.id === p.id ? "default" : "ghost"}
                    className="w-full justify-start text-lg h-12"
                  >
                    <span className="mr-3">{p.avatar || "👶"}</span> {p.name}
                    <LinkPendingSpinner size={18} className="ml-auto" />
                  </Button>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Suspense
            fallback={
              <SidebarCardFallback
                icon={<PushPin size={20} className="mr-2 text-primary" />}
                title="Approved Videos"
              />
            }
          >
            <PinnedVideosCard
              profileId={activeProfile.id}
              profileName={activeProfile.name}
              returnTo={dashboardUrl()}
              refreshed={refreshed == null ? null : Number(refreshed) | 0}
              removed={Number(removed) | 0}
            />
          </Suspense>

          <Suspense
            fallback={
              <SidebarCardFallback
                icon={<Check size={20} className="mr-2 text-primary" />}
                title="Approved Channels"
              />
            }
          >
            <ApprovedChannelsCard
              profileId={activeProfile.id}
              profileName={activeProfile.name}
            />
          </Suspense>

          <Suspense
            fallback={
              <SidebarCardFallback
                icon={<MusicNotes size={20} className="mr-2 text-primary" />}
                title="Import Songs"
              />
            }
          >
            <SongImportCard
              userId={user.id}
              songsVideo={songsVideo}
              returnTo={dashboardUrl()}
            />
          </Suspense>
        </div>

        {/* Main Content: Search YouTube */}
        <div className="order-1 lg:order-2 lg:col-span-3 space-y-8">
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="pt-6 space-y-4">
              <div className="flex gap-2">
                <Link href={dashboardUrl({ type: "videos" })}>
                  <Button
                    variant={
                      searchType === "videos" ? "default" : "outline"
                    }
                    size="touch"
                  >
                    <LinkPendingSpinner
                      fallback={<Video className="mr-2" />}
                      className="mr-2"
                    />{" "}
                    Videos
                  </Button>
                </Link>
                <Link href={dashboardUrl({ type: "channels" })}>
                  <Button
                    variant={
                      searchType === "channels" ? "default" : "outline"
                    }
                    size="touch"
                  >
                    <LinkPendingSpinner
                      fallback={<Users className="mr-2" />}
                      className="mr-2"
                    />{" "}
                    Channels
                  </Button>
                </Link>
              </div>
              <DashboardSearch
                profileId={activeProfile.id}
                searchType={searchType}
                query={query}
              />
            </CardContent>
          </Card>

          {drillChannelId ? (
            // ?channel=<UCid> (type=channels) replaces the results
            // area — the "All channels" back link keeps q context.
            <Suspense
              key={drillChannelId}
              fallback={<SearchResultsFallback />}
            >
              <ChannelDetail
                channelId={drillChannelId}
                profileId={activeProfile.id}
                profileName={activeProfile.name}
                allChannelsHref={dashboardUrl()}
                previewBaseHref={dashboardUrl({
                  channel: drillChannelId,
                })}
              />
            </Suspense>
          ) : query ? (
            // profileId in the key: switching kid with the same
            // q+type must remount the grid or its pinned/approved
            // sets go stale.
            <Suspense
              key={`${activeProfile.id}:${searchType}:${query}`}
              fallback={<SearchResultsFallback />}
            >
              <SearchResults
                query={query}
                searchType={searchType}
                profileId={activeProfile.id}
                profileName={activeProfile.name}
                previewBaseHref={dashboardUrl()}
                channelBaseHref={dashboardUrl()}
              />
            </Suspense>
          ) : (
            <div
              className={cn(
                "flex flex-col items-center justify-center",
                "py-20 text-center space-y-4"
              )}
            >
              <div
                className={cn(
                  "w-20 h-20 bg-muted rounded-full flex",
                  "items-center justify-center text-muted-foreground"
                )}
              >
                <Video size={40} />
              </div>
              <div>
                <h3 className="text-xl font-semibold">Start Curating</h3>
                <p className="text-muted-foreground">
                  Search for safe videos or channels to add to{" "}
                  {activeProfile.name}&apos;s whitelist.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ?video= in-app preview overlay — composes with search results
          AND the channel drill-in; closeHref keeps the drill-in. */}
      {previewVideoId && (
        <Suspense fallback={null}>
          <VideoPreview
            videoId={previewVideoId}
            profileId={activeProfile.id}
            profileName={activeProfile.name}
            closeHref={dashboardUrl({ channel: drillChannelId })}
          />
        </Suspense>
      )}
    </div>
  );
}
