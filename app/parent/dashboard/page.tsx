import { Suspense } from "react";
import { getSession, parentSession } from "@/lib/auth";
import { getManageableProfiles } from "@/lib/profiles";
import { redirect } from "next/navigation";
import { ChannelDetail } from "./_components/channel-detail";
import { VideoPreview } from "./_components/video-preview";
import {
  SearchResultsFallback,
  SidebarCardFallback,
} from "./_components/fallbacks";
import { PinnedVideosCard } from "./_components/pinned-videos-card";
import { ApprovedChannelsCard } from "./_components/approved-channels-card";
import { SongImportCard } from "./_components/song-import-card";
import { SearchResults } from "./_components/search-results";
import {
  CHANNEL_ID_PARAM_RE,
  VIDEO_ID_PARAM_RE,
  dashboardUrl,
} from "./_components/dashboard-url";
import { Button } from "@/components/ui/button";
import { LinkPendingSpinner } from "@/components/link-pending-spinner";
import { DashboardSearch } from "./_components/dashboard-search";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Check,
  MusicNotes,
  PushPin,
  Users,
  Video,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import DailySyncPing from "@/components/daily-sync-ping";
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

  // Base link context — dashboardUrl applies the keep/drop rules.
  const base = {
    profileId: activeProfile.id,
    q: query,
    type: searchType,
  } as const;

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
                  href={dashboardUrl(base, { profileId: p.id })}
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
              returnTo={dashboardUrl(base)}
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
              returnTo={dashboardUrl(base)}
            />
          </Suspense>
        </div>

        {/* Main Content: Search YouTube */}
        <div className="order-1 lg:order-2 lg:col-span-3 space-y-8">
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="pt-6 space-y-4">
              <div className="flex gap-2">
                <Link href={dashboardUrl(base, { type: "videos" })}>
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
                <Link href={dashboardUrl(base, { type: "channels" })}>
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
                allChannelsHref={dashboardUrl(base)}
                previewBaseHref={dashboardUrl(base, {
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
                previewBaseHref={dashboardUrl(base)}
                channelBaseHref={dashboardUrl(base)}
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
            closeHref={dashboardUrl(base, { channel: drillChannelId })}
          />
        </Suspense>
      )}
    </div>
  );
}
