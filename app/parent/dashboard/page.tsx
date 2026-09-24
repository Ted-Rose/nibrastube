import { db } from "@/lib/db";
import { channels, videos, whitelistedChannels, whitelistedVideos } from "@/lib/db/schema";
import { getSession } from "@/lib/auth";
import { getManageableProfiles } from "@/lib/profiles";
import { and, count, eq, inArray, isNotNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { searchChannels, searchYouTube } from "@/lib/youtube";
import { pinVideo, unpinVideo } from "@/app/actions/pinning";
import { approveChannel, unapproveChannel } from "@/app/actions/channels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Baby, Check, MagnifyingGlass, PushPin, SpinnerGap, Trash, Users, Video } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import { logoutAction } from "@/app/actions/auth";
import DailySyncPing from "@/components/daily-sync-ping";

interface DashboardProps {
  searchParams: Promise<{ q?: string; profileId?: string; type?: string }>;
}

export default async function DashboardPage({ searchParams }: DashboardProps) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { q, profileId, type } = await searchParams;
  const query = q || "";
  const searchType = type === "channels" ? "channels" : "videos";
  const selectedProfileId = profileId;
  console.log("Dashboard Rendering - Query:", query, "Type:", searchType, "ProfileId:", selectedProfileId);

  // Get all profiles this parent owns or has shared access to
  const parentProfiles = await getManageableProfiles(session.user.id);

  if (parentProfiles.length === 0) {
    redirect("/parent/profiles");
  }

  // Determine active profile
  const activeProfile = selectedProfileId
    ? parentProfiles.find(p => p.id === selectedProfileId)
    : parentProfiles[0];

  // Search results if query exists
  const videoResults = query && searchType === "videos" ? await searchYouTube(query) : [];
  const channelResults = query && searchType === "channels" ? await searchChannels(query) : [];

  // Get currently pinned videos for active profile
  const pinnedRelations = activeProfile
    ? await db.query.whitelistedVideos.findMany({
        where: eq(whitelistedVideos.profileId, activeProfile.id),
      })
    : [];

  const pinnedVideoIds = pinnedRelations.map(r => r.videoId);

  const pinnedVideos = pinnedVideoIds.length > 0
    ? await db.query.videos.findMany({
        where: inArray(videos.id, pinnedVideoIds),
      })
    : [];

  // Approved channels for the active profile (+ per-channel pin counts)
  const approvedChannels = activeProfile
    ? await db
        .select({ whitelist: whitelistedChannels, channel: channels })
        .from(whitelistedChannels)
        .innerJoin(channels, eq(whitelistedChannels.channelId, channels.id))
        .where(eq(whitelistedChannels.profileId, activeProfile.id))
    : [];

  const channelPinCounts = activeProfile
    ? await db
        .select({ channelId: whitelistedVideos.viaChannelId, total: count() })
        .from(whitelistedVideos)
        .where(and(eq(whitelistedVideos.profileId, activeProfile.id), isNotNull(whitelistedVideos.viaChannelId)))
        .groupBy(whitelistedVideos.viaChannelId)
    : [];
  const pinCountByChannel = new Map(channelPinCounts.map(r => [r.channelId, r.total]));
  const approvedChannelIds = new Set(approvedChannels.map(r => r.channel.id));

  const dashboardHref = (searchTypeParam: string) =>
    `/parent/dashboard?profileId=${activeProfile?.id ?? ""}${query ? `&q=${encodeURIComponent(query)}` : ""}&type=${searchTypeParam}`;

  return (
    <div className="container mx-auto py-10 px-4">
      <DailySyncPing />
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Parent Portal</h1>
          <p className="text-muted-foreground mt-1">Search and approve videos for your kids</p>
        </div>
        <div className="flex gap-2">
           <Link href="/parent/profiles">
            <Button variant="outline"><Users className="mr-2" /> Manage Kids</Button>
          </Link>
          <Link href="/kids">
            <Button variant="outline"><Baby className="mr-2" /> Kids Corner</Button>
          </Link>
          <form action={logoutAction}>
            <Button variant="ghost" type="submit">Logout</Button>
          </form>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar: Profile Selection & Pinned Videos */}
        <div className="lg:col-span-1 space-y-6">
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
                    variant={activeProfile?.id === p.id ? "default" : "ghost"}
                    className="w-full justify-start text-lg h-12"
                  >
                    <span className="mr-3">{p.avatar || "👶"}</span> {p.name}
                  </Button>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center">
                <PushPin size={20} className="mr-2 text-primary" /> Approved Videos
              </CardTitle>
              <CardDescription>{pinnedVideos.length} approved for {activeProfile?.name}</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <div className="max-h-[400px] overflow-y-auto px-6 space-y-4">
                {pinnedVideos.length === 0 && (
                  <p className="text-sm text-muted-foreground italic">No videos approved yet.</p>
                )}
                {pinnedVideos.map(v => (
                  <div key={v.id} className="flex gap-3 group items-center">
                    <img src={v.thumbnail} className="w-16 h-10 object-cover rounded shadow-sm" alt="" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{v.title}</p>
                    </div>
                    <form action={unpinVideo.bind(null, activeProfile!.id, v.id)}>
                      <Button type="submit" variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                        <Trash size={16} />
                      </Button>
                    </form>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center">
                <Check size={20} className="mr-2 text-primary" /> Approved Channels
              </CardTitle>
              <CardDescription>{approvedChannels.length} channels approved for {activeProfile?.name}</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <div className="max-h-[400px] overflow-y-auto px-6 space-y-4">
                {approvedChannels.length === 0 && (
                  <p className="text-sm text-muted-foreground italic">No channels approved yet. Search for channels above.</p>
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
                    <form action={unapproveChannel.bind(null, activeProfile!.id, channel.id)}>
                      <Button type="submit" variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                        <Trash size={16} />
                      </Button>
                    </form>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content: Search YouTube */}
        <div className="lg:col-span-3 space-y-8">
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="pt-6 space-y-4">
              <div className="flex gap-2">
                <Link href={dashboardHref("videos")}>
                  <Button variant={searchType === "videos" ? "default" : "outline"} size="sm">
                    <Video className="mr-2" /> Videos
                  </Button>
                </Link>
                <Link href={dashboardHref("channels")}>
                  <Button variant={searchType === "channels" ? "default" : "outline"} size="sm">
                    <Users className="mr-2" /> Channels
                  </Button>
                </Link>
              </div>
              <form action="/parent/dashboard" method="GET" className="flex gap-2">
                <input type="hidden" name="profileId" value={activeProfile?.id} />
                <input type="hidden" name="type" value={searchType} />
                <div className="relative flex-1">
                  <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                  <Input
                    name="q"
                    placeholder={searchType === "channels" ? "Search YouTube channels (e.g., Cocomelon, Nat Geo Kids)..." : "Search YouTube (e.g., Cocomelon, Nat Geo Kids)..."}
                    defaultValue={query}
                    className="pl-10 h-14 text-lg bg-background border-2"
                  />
                </div>
                <Button type="submit" size="lg" className="px-8 h-14 text-lg">Search</Button>
              </form>
            </CardContent>
          </Card>

          {query && searchType === "videos" && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {videoResults.map((video) => {
                const isPinned = pinnedVideoIds.includes(video.id);
                return (
                  <Card key={video.id} className="overflow-hidden group hover:ring-2 hover:ring-primary/40 transition-all flex flex-col">
                    <div className="relative aspect-video">
                      <img src={video.thumbnail} className="w-full h-full object-cover" alt={video.title} />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                         <a href={`https://youtube.com/watch?v=${video.id}`} target="_blank" className="text-white bg-black/60 p-2 rounded-full hover:bg-black/80 transition-colors">
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
                        <form action={pinVideo.bind(null, activeProfile!.id, video.id)} className="w-full">
                          <Button type="submit" variant="outline" className="w-full hover:bg-primary hover:text-white transition-colors">
                            Pin to {activeProfile?.name}
                          </Button>
                        </form>
                      )}
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          )}

          {query && searchType === "channels" && (
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
                        <form action={approveChannel.bind(null, activeProfile!.id, channel.id)} className="w-full">
                          <Button type="submit" variant="outline" className="w-full hover:bg-primary hover:text-white transition-colors">
                            Approve Channel for {activeProfile?.name}
                          </Button>
                        </form>
                      )}
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          )}

          {!query && (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
              <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center text-muted-foreground">
                <Video size={40} />
              </div>
              <div>
                <h3 className="text-xl font-semibold">Start Curating</h3>
                <p className="text-muted-foreground">Search for safe videos or channels to add to {activeProfile?.name}&apos;s whitelist.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
