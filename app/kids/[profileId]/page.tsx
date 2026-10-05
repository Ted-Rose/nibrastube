import { Suspense } from "react";
import { db } from "@/lib/db";
import {
  channels,
  profiles,
  whitelistedChannels,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  Heart,
  MonitorPlay,
  Play,
  House,
  SpinnerGap,
  UserSwitch,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import PusherListener from "@/components/pusher-listener";
import DailySyncPing from "@/components/daily-sync-ping";
import { KidsFooterGate } from "@/components/kids-footer-gate";
import { KidsSearch } from "@/components/kids-search";
import { KidsVideoGrid } from "@/components/kids-video-grid";
import { KidsSortSelect } from "@/components/kids-sort-select";
import { LinkPendingSpinner } from "@/components/link-pending-spinner";
import { getSession } from "@/lib/auth";
import { canViewProfile } from "@/lib/profiles";
import { cookies } from "next/headers";
import {
  getKidsChannels,
  getKidsVideos,
  getLikedVideos,
  kidsFeedQuery,
  parseKidsFeedParams,
  type KidsFeedParams,
} from "@/lib/kids-feed";

interface KidsPortalProps {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const tabBase =
  "flex items-center justify-center gap-2 sm:gap-3 rounded-full px-4 sm:px-6 py-2.5 sm:py-3 text-base sm:text-xl font-black transition-colors";
const tabActive = "bg-primary text-white shadow-md";
const tabInactive = "text-slate-500 hover:bg-slate-100";

// Everything below the tab bar fetches feed rows and streams in under its
// own Suspense boundary, so header + tabs paint while the (remote) DB work
// is still in flight.
async function FeedContent({
  profileId,
  feed,
}: {
  profileId: string;
  feed: KidsFeedParams;
}) {
  const { view, channel, q: query } = feed;
  const drilledIn = view === "channels" && channel !== null;
  const showVideoGrid = view === "videos" || drilledIn;

  // Single helper so tabs/sorts/drill-down links never drop each other's params
  const portalUrl = (overrides: Partial<KidsFeedParams> = {}) =>
    `/kids/${profileId}${kidsFeedQuery(feed, overrides)}`;

  const rows =
    view === "liked"
      ? await getLikedVideos(profileId, { q: query })
      : showVideoGrid
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

  return (
    <>
      {drilledIn && (
        <div className="mb-6">
          <Link
            href={portalUrl({ channel: null })}
            className="inline-flex items-center gap-2 text-lg font-bold text-slate-500 hover:text-slate-800 transition-colors"
          >
            <ArrowLeft size={20} weight="bold" />
            All channels
            <LinkPendingSpinner size={20} weight="bold" />
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
                 : view === "liked"
                   ? "Liked Videos"
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
                <Card className="relative overflow-hidden border-0 shadow-lg rounded-[32px] group-hover:-translate-y-2 transition-transform duration-300 bg-white">
                  <LinkPendingSpinner
                    size={24}
                    weight="bold"
                    className="absolute right-5 top-5 text-slate-400"
                  />
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
                      <h3 className="text-xl font-bold line-clamp-2 leading-tight text-slate-900 group-hover:underline">
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
               {view === "liked" ? (
                 <Heart size={48} weight="fill" />
               ) : (
                 <Play size={48} weight="fill" />
               )}
           </div>
           <p className="text-2xl font-bold text-slate-400">
             {query
               ? "No videos found!"
               : view === "liked"
                 ? "No liked videos yet! Tap the 👍 while watching."
                 : channelApproved
                   ? "Videos are on the way!"
                   : "Ask Mom or Dad to pick some videos!"}
           </p>
        </div>
      ) : (
        <KidsVideoGrid
          rows={rows}
          profileId={profileId}
          feedQuery={kidsFeedQuery(feed)}
        />
      )}
    </>
  );
}

function FeedFallback() {
  return (
    <div className="flex items-center justify-center py-32 text-slate-300">
      <SpinnerGap size={48} className="animate-spin" />
    </div>
  );
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

  // Access check before the existence check so a signed-in parent can't
  // use 404-vs-redirect to probe whether a profile UUID exists.
  const activeProfileId = (await cookies()).get("activeProfileId")?.value;
  if (!(await canViewProfile(session, profileId, activeProfileId))) {
    redirect("/kids");
  }

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, profileId),
  });

  if (!profile) notFound();

  // Single helper so tabs/sorts/drill-down links never drop each other's params
  const portalUrl = (overrides: Partial<KidsFeedParams> = {}) =>
    `/kids/${profileId}${kidsFeedQuery(feed, overrides)}`;

  const showVideoGrid = view === "videos" || drilledIn;

  return (
    <div className="min-h-screen bg-[#F0F4FF]">
      <PusherListener profileId={profileId} />
      <DailySyncPing />
      {/* Kids Header */}
      <header className="bg-white border-b-4 border-slate-100 px-4 sm:px-6 pt-[max(1rem,env(safe-area-inset-top))] pb-3 sm:pb-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
          <div className="flex items-center gap-3">
             <Link
               href="/kids"
               aria-label="Switch profile"
               // /kids is auth-conditional: proxy.ts 307-redirects it to
               // /login on locked kid devices. A prefetched redirect
               // pollutes the router's segment cache and can replay on
               // later navigations — always resolve it fresh on click.
               prefetch={false}
               className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-900"
             >
               <House size={32} weight="bold" />
             </Link>
             <span className="text-xl font-black text-slate-900 hidden md:block">NibrasTube</span>
          </div>

          <KidsSearch
            profileId={profileId}
            view={view}
            channel={channel}
            sort={feed.sort}
            dir={feed.dir}
            query={query}
            placeholder={
              view === "channels" && !drilledIn
                ? `Search ${profile.name}'s channels...`
                : `Search ${profile.name}'s videos...`
            }
          />

          <Link
            href="/kids"
            aria-label="Switch profile"
            prefetch={false}
            className="group flex items-center gap-3 rounded-2xl hover:opacity-80 transition-opacity"
          >
             <span className="text-xl font-black text-slate-700 hidden sm:block">{profile.name}</span>
             <div className="relative">
               <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-2xl bg-white border-4 border-primary shadow-sm flex items-center justify-center text-2xl sm:text-3xl">
                  {profile.avatar}
               </div>
               <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center shadow-sm">
                 <UserSwitch size={14} weight="bold" />
               </div>
             </div>
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 mt-6 sm:mt-10">
        {/* View tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 mb-8">
          <div className="grid grid-cols-3 gap-1 rounded-full bg-white p-1 shadow-sm sm:inline-flex">
            <Link
              href={portalUrl({ view: "videos", channel: null })}
              className={`${tabBase} ${view === "videos" ? tabActive : tabInactive}`}
            >
              <LinkPendingSpinner
                size={24}
                weight="bold"
                fallback={<Play size={24} weight="fill" />}
              />
              Videos
            </Link>
            <Link
              href={portalUrl({ view: "channels", channel: null })}
              className={`${tabBase} ${view === "channels" ? tabActive : tabInactive}`}
            >
              <LinkPendingSpinner
                size={24}
                weight="bold"
                fallback={<MonitorPlay size={24} weight="bold" />}
              />
              Channels
            </Link>
            <Link
              href={portalUrl({ view: "liked", channel: null })}
              className={`${tabBase} ${view === "liked" ? tabActive : tabInactive}`}
            >
              <LinkPendingSpinner
                size={24}
                weight="bold"
                fallback={
                  <Heart
                    size={24}
                    weight={view === "liked" ? "fill" : "bold"}
                  />
                }
              />
              Liked
            </Link>
          </div>
          {showVideoGrid && (
            <KidsSortSelect
              value={`${feed.sort}:${feed.dir}`}
              className="w-full sm:w-auto sm:ml-auto"
            />
          )}
        </div>

        <Suspense fallback={<FeedFallback />}>
          <FeedContent profileId={profileId} feed={feed} />
        </Suspense>
      </main>

      {/* Parental Gate to switch to Parent Portal altogether — inline so
          it can never overlap grid content */}
      <footer className="mt-16 flex justify-center pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <KidsFooterGate />
      </footer>
    </div>
  );
}
