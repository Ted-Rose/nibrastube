import { db } from "@/lib/db";
import {
  channels,
  profiles,
  whitelistedChannels,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  MagnifyingGlass,
  MonitorPlay,
  Play,
  House,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import PusherListener from "@/components/pusher-listener";
import DailySyncPing from "@/components/daily-sync-ping";
import { KidsFooterGate } from "@/components/kids-footer-gate";
import { VideoCard } from "@/components/video-card";
import { KidsSortSelect } from "@/components/kids-sort-select";
import { getSession } from "@/lib/auth";
import {
  getKidsChannels,
  getKidsVideos,
  kidsFeedQuery,
  parseKidsFeedParams,
  type KidsFeedParams,
} from "@/lib/kids-feed";

interface KidsPortalProps {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function KidsPortalPage({
  params,
  searchParams,
}: KidsPortalProps) {
  const session = await getSession();
  const { profileId } = await params;

  // Basic UUID validation to prevent DB crash
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(profileId)) {
    redirect("/kids");
  }

  const feed = parseKidsFeedParams(await searchParams);
  const { view, channel, q: query } = feed;
  const drilledIn = view === "channels" && channel !== null;

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, profileId),
  });

  if (!profile) notFound();

  // Single helper so tabs/sorts/drill-down links never drop each other's params
  const portalUrl = (overrides: Partial<KidsFeedParams> = {}) =>
    `/kids/${profileId}${kidsFeedQuery(feed, overrides)}`;
  const watchUrl = (videoId: string) =>
    `/kids/${profileId}/watch/${videoId}${kidsFeedQuery(feed)}`;

  const showVideoGrid = view === "videos" || drilledIn;
  const rows = showVideoGrid
    ? await getKidsVideos(profileId, {
        q: query,
        channelId: channel,
        sort: feed.sort,
        dir: feed.dir,
      })
    : [];
  const channelRows =
    view === "channels" && !drilledIn
      ? await getKidsChannels(profileId, { q: query })
      : [];

  let channelTitle: string | null = null;
  let channelApproved = false;
  if (drilledIn) {
    channelTitle =
      rows[0]?.video.channelTitle ??
      (
        await db.query.channels.findFirst({
          where: eq(channels.id, channel),
        })
      )?.title ??
      "Channel";
    if (rows.length === 0) {
      channelApproved = !!(await db.query.whitelistedChannels.findFirst({
        where: and(
          eq(whitelistedChannels.profileId, profileId),
          eq(whitelistedChannels.channelId, channel)
        ),
      }));
    }
  }

  const tabBase =
    "flex items-center gap-3 rounded-full px-6 py-3 text-xl font-black transition-colors";
  const tabActive = "bg-primary text-white shadow-md";
  const tabInactive = "bg-white text-slate-500 hover:bg-slate-100";

  return (
    <div className="min-h-screen bg-[#F0F4FF] pb-20">
      <PusherListener profileId={profileId} />
      <DailySyncPing />
      {/* Kids Header */}
      <header className="bg-white border-b-4 border-slate-100 px-6 py-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
             <KidsFooterGate
                correctPin={session?.user?.parentPin || "0000"}
                target="/kids"
                trigger={
                  <div className="p-2 hover:bg-slate-100 rounded-full transition-colors cursor-pointer">
                    <House size={32} weight="bold" />
                  </div>
                }
             />
             <span className="text-xl font-black hidden md:block">NibrasTube</span>
          </div>

          <div className="flex-1 max-w-2xl relative">
            <MagnifyingGlass className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={24} weight="fill" />
            <form action={`/kids/${profileId}`} method="GET">
              {view !== "videos" && (
                <input type="hidden" name="view" value={view} />
              )}
              {channel && (
                <input type="hidden" name="channel" value={channel} />
              )}
              {feed.sort !== "age" && (
                <input type="hidden" name="sort" value={feed.sort} />
              )}
              {feed.dir !== "desc" && (
                <input type="hidden" name="dir" value={feed.dir} />
              )}
              <Input
                name="q"
                defaultValue={query}
                placeholder={
                  view === "channels" && !drilledIn
                    ? `Search ${profile.name}'s channels...`
                    : `Search ${profile.name}'s videos...`
                }
                className="pl-14 h-14 text-xl rounded-full border-4 border-slate-50 bg-slate-50 focus:bg-white transition-all shadow-inner"
              />
            </form>
          </div>

          <div className="flex items-center gap-3">
             <span className="text-xl font-black text-slate-700 hidden sm:block">{profile.name}</span>
             <div className="w-14 h-14 rounded-2xl bg-white border-4 border-primary shadow-sm flex items-center justify-center text-3xl">
                {profile.avatar}
             </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 mt-10">
        {/* View tabs */}
        <div className="flex items-center gap-4 mb-8">
          <Link
            href={portalUrl({ view: "videos", channel: null })}
            className={`${tabBase} ${view === "videos" ? tabActive : tabInactive}`}
          >
            <Play size={24} weight="fill" />
            Videos
          </Link>
          <Link
            href={portalUrl({ view: "channels", channel: null })}
            className={`${tabBase} ${view === "channels" ? tabActive : tabInactive}`}
          >
            <MonitorPlay size={24} weight="bold" />
            Channels
          </Link>
          {showVideoGrid && (
            <div className="ml-auto">
              <KidsSortSelect value={`${feed.sort}:${feed.dir}`} />
            </div>
          )}
        </div>

        {drilledIn && (
          <div className="mb-6">
            <Link
              href={portalUrl({ channel: null })}
              className="inline-flex items-center gap-2 text-lg font-bold text-slate-500 hover:text-slate-800 transition-colors"
            >
              <ArrowLeft size={20} weight="bold" />
              All channels
            </Link>
          </div>
        )}

        <div className="flex items-center justify-between mb-8">
           <h2 className="text-3xl font-black text-slate-900 tracking-tight">
             {drilledIn
               ? channelTitle
               : query
                 ? `Results for "${query}"`
                 : view === "channels"
                   ? "Channels"
                   : "Approved Videos"}
           </h2>
        </div>

        {view === "channels" && !drilledIn ? (
          channelRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-32 text-center bg-white rounded-[40px] shadow-sm border-4 border-slate-100">
               <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 mb-6">
                   <MonitorPlay size={48} weight="fill" />
               </div>
               <p className="text-2xl font-bold text-slate-400">
                 {query
                   ? "No channels found!"
                   : "Ask Mom or Dad to approve some channels!"}
               </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
              {channelRows.map((c) => (
                <Link key={c.id} href={portalUrl({ channel: c.id })} className="group">
                  <Card className="overflow-hidden border-0 shadow-lg rounded-[32px] group-hover:-translate-y-2 transition-transform duration-300 bg-white">
                    <CardContent className="p-8 flex flex-col items-center text-center gap-4">
                      {c.thumbnail ? (
                        <img
                          src={c.thumbnail}
                          className="w-24 h-24 rounded-full object-cover border-4 border-slate-100"
                          alt={c.title}
                        />
                      ) : (
                        <div className="w-24 h-24 rounded-full bg-primary/10 text-primary border-4 border-slate-100 flex items-center justify-center text-4xl font-black">
                          {c.title.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <h3 className="text-xl font-bold line-clamp-2 leading-tight group-hover:underline">
                          {c.title}
                        </h3>
                        <p className="text-slate-500 mt-2 font-medium">
                          {c.videoCount} {c.videoCount === 1 ? "video" : "videos"}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center bg-white rounded-[40px] shadow-sm border-4 border-slate-100">
             <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 mb-6">
                 <Play size={48} weight="fill" />
             </div>
             <p className="text-2xl font-bold text-slate-400">
               {query
                 ? "No videos found!"
                 : channelApproved
                   ? "Videos are on the way!"
                   : "Ask Mom or Dad to pick some videos!"}
             </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            {rows.map(({ video, progress }) => (
              <VideoCard
                key={video.id}
                href={watchUrl(video.id)}
                video={video}
                progress={progress}
              />
            ))}
          </div>
        )}
      </main>

      {/* Parental Gate to switch to Parent Portal altogether */}
      <div className="fixed bottom-6 right-6">
        <KidsFooterGate
          correctPin={session?.user?.parentPin || "0000"}
          target="/parent/dashboard"
        />
      </div>
    </div>
  );
}
