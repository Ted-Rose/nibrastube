import { Suspense } from "react";
import { db } from "@/lib/db";
import { channels, videos, whitelistedChannels, whitelistedVideos } from "@/lib/db/schema";
import { getSession } from "@/lib/auth";
import { getManageableProfiles } from "@/lib/profiles";
import { and, count, desc, eq, isNotNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { searchChannels, searchYouTube } from "@/lib/youtube";
import { pinVideo } from "@/app/actions/pinning";
import { approveChannel, unapproveChannel } from "@/app/actions/channels";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { LinkPendingSpinner } from "@/components/link-pending-spinner";
import { DashboardSearch } from "@/components/dashboard-search";
import { PinnedVideosPanel } from "@/components/pinned-videos-panel";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, PushPin, SpinnerGap, Trash, Users, Video } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import DailySyncPing from "@/components/daily-sync-ping";

interface DashboardProps {
  searchParams: Promise<{ q?: string; profileId?: string; type?: string }>;
}

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
    <div className="flex items-center justify-center py-20 text-muted-foreground">
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
}: {
  profileId: string;
  profileName: string;
}) {
  const pinnedVideos = await db
    .select({
      id: videos.id,
      title: videos.title,
      thumbnail: videos.thumbnail,
    })
    .from(whitelistedVideos)
    .innerJoin(videos, eq(whitelistedVideos.videoId, videos.id))
    .where(eq(whitelistedVideos.profileId, profileId))
    .orderBy(desc(whitelistedVideos.pinnedAt));

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
        <div className="max-h-[400px] overflow-y-auto px-6">
          {pinnedVideos.length === 0 && (
            <p className="text-sm text-muted-foreground italic">
              No videos approved yet.
            </p>
          )}
          <PinnedVideosPanel videos={pinnedVideos} profileId={profileId} />
        </div>
      </CardContent>
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
  const [approvedChannels, channelPinCounts] = await Promise.all([
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
  ]);
  const pinCountByChannel = new Map(
    channelPinCounts.map((r) => [r.channelId, r.total])
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
          {approvedChannels.map(({ whitelist, channel }) => (
            <div key={channel.id} className="flex gap-3 group items-center">
              {channel.thumbnail ? (
                <img src={channel.thumbnail} className="w-10 h-10 object-cover rounded-full shadow-sm" alt="" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                  <Video size={18} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{channel.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {pinCountByChannel.get(channel.id) ?? 0} videos
                  {whitelist.lastSyncAt && ` · synced ${whitelist.lastSyncAt.toLocaleDateString()}`}
                </p>
                {!whitelist.backfillComplete && (
                  <p className="text-[11px] text-primary flex items-center gap-1">
                    <SpinnerGap size={12} className="animate-spin" /> Syncing…
                  </p>
                )}
              </div>
              <form action={unapproveChannel.bind(null, profileId, channel.id)}>
                <SubmitButton variant="ghost" size="icon-touch" aria-label={`Unapprove ${channel.title}`} className="text-destructive opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                  <Trash size={20} />
                </SubmitButton>
              </form>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// YouTube search + the pinned/approved lookups the result buttons need all
// run here, inside Suspense — the page shell paints instantly and only this
// region waits on the YouTube API.
async function SearchResults({
  query,
  searchType,
  profileId,
  profileName,
}: {
  query: string;
  searchType: "videos" | "channels";
  profileId: string;
  profileName: string;
}) {
  const [videoResults, channelResults, pinnedRelations, approvedRelations] =
    await Promise.all([
      searchType === "videos" ? searchYouTube(query) : Promise.resolve([]),
      searchType === "channels" ? searchChannels(query) : Promise.resolve([]),
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
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {channelResults.map((channel) => {
          const isApproved = approvedChannelIds.has(channel.id);
          return (
            <Card key={channel.id} className="overflow-hidden group hover:ring-2 hover:ring-primary/40 transition-all flex flex-col">
              <CardHeader className="p-4 flex-1">
                <div className="flex items-center gap-4">
                  <img src={channel.thumbnail} className="w-16 h-16 object-cover rounded-full shadow-sm" alt={channel.title} />
                  <CardTitle className="text-base line-clamp-2 leading-snug">{channel.title}</CardTitle>
                </div>
              </CardHeader>
              <CardFooter className="p-4 pt-0">
                {isApproved ? (
                  <Button disabled className="w-full bg-green-100 text-green-700 hover:bg-green-100 border-green-200">
                    <Check size={18} className="mr-2" /> Approved
                  </Button>
                ) : (
                  <form action={approveChannel.bind(null, profileId, channel.id)} className="w-full">
                    <SubmitButton variant="outline" size="touch" pendingLabel="Approving…" className="w-full hover:bg-primary hover:text-white transition-colors">
                      Approve Channel for {profileName}
                    </SubmitButton>
                  </form>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      {videoResults.map((video) => {
        const isPinned = pinnedVideoIds.has(video.id);
        return (
          <Card key={video.id} className="overflow-hidden group hover:ring-2 hover:ring-primary/40 transition-all flex flex-col">
            <div className="relative aspect-video">
              <img src={video.thumbnail} className="w-full h-full object-cover" alt={video.title} />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                 <a href={`https://youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer" className="text-white bg-black/60 p-2 rounded-full hover:bg-black/80 transition-colors">
                    <Video size={32} />
                 </a>
              </div>
            </div>
            <CardHeader className="p-4 flex-1">
              <CardTitle className="text-sm line-clamp-2 leading-snug">{video.title}</CardTitle>
              <CardDescription className="text-xs">{video.channelTitle}</CardDescription>
            </CardHeader>
            <CardFooter className="p-4 pt-0">
              {isPinned ? (
                <Button disabled className="w-full bg-green-100 text-green-700 hover:bg-green-100 border-green-200">
                  <PushPin size={18} className="mr-2" /> Approved
                </Button>
              ) : (
                <form action={pinVideo.bind(null, profileId, video.id)} className="w-full">
                  <SubmitButton variant="outline" size="touch" pendingLabel="Pinning…" className="w-full hover:bg-primary hover:text-white transition-colors">
                    Pin to {profileName}
                  </SubmitButton>
                </form>
              )}
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}

export default async function DashboardPage({ searchParams }: DashboardProps) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { q, profileId, type } = await searchParams;
  const query = q || "";
  const searchType = type === "channels" ? "channels" : "videos";
  const selectedProfileId = profileId;

  // Get all profiles this parent owns or has shared access to
  const parentProfiles = await getManageableProfiles(session.user.id);

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

  const dashboardHref = (searchTypeParam: string) =>
    `/parent/dashboard?profileId=${activeProfile.id}${query ? `&q=${encodeURIComponent(query)}` : ""}&type=${searchTypeParam}`;

  return (
    <div className="container mx-auto py-6 sm:py-10 px-4">
      <DailySyncPing />
      <div className="mb-6 sm:mb-10">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Parent Portal</h1>
        <p className="text-muted-foreground mt-1">Search and approve videos for your kids</p>
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
                  href={`/parent/dashboard?profileId=${p.id}${query ? `&q=${encodeURIComponent(query)}` : ""}&type=${searchType}`}
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
        </div>

        {/* Main Content: Search YouTube */}
        <div className="order-1 lg:order-2 lg:col-span-3 space-y-8">
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="pt-6 space-y-4">
              <div className="flex gap-2">
                <Link href={dashboardHref("videos")}>
                  <Button variant={searchType === "videos" ? "default" : "outline"} size="touch">
                    <LinkPendingSpinner fallback={<Video className="mr-2" />} className="mr-2" /> Videos
                  </Button>
                </Link>
                <Link href={dashboardHref("channels")}>
                  <Button variant={searchType === "channels" ? "default" : "outline"} size="touch">
                    <LinkPendingSpinner fallback={<Users className="mr-2" />} className="mr-2" /> Channels
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

          {query ? (
            <Suspense
              key={`${searchType}:${query}`}
              fallback={<SearchResultsFallback />}
            >
              <SearchResults
                query={query}
                searchType={searchType}
                profileId={activeProfile.id}
                profileName={activeProfile.name}
              />
            </Suspense>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
              <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center text-muted-foreground">
                <Video size={40} />
              </div>
              <div>
                <h3 className="text-xl font-semibold">Start Curating</h3>
                <p className="text-muted-foreground">Search for safe videos or channels to add to {activeProfile.name}&apos;s whitelist.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
