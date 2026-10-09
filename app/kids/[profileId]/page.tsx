import { Suspense } from "react";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { House, UserSwitch } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import PusherListener from "@/components/pusher-listener";
import DailySyncPing from "@/components/daily-sync-ping";
import { KidsFooterGate } from "@/components/kids-footer-gate";
import { KidsSearch } from "@/components/kids-search";
import { KidsViewMenu } from "@/components/kids-view-menu";
import { VideoGridSkeleton } from "@/components/video-grid-skeleton";
import { getSession } from "@/lib/auth";
import { canViewProfile } from "@/lib/profiles";
import { cookies } from "next/headers";
import {
  kidsPortalUrl,
  parseKidsFeedParams,
  type KidsFeedParams,
} from "@/lib/kids-feed";
import { FeedContent } from "./_components/feed-content";
import { KIDS_VIEWS, searchPlaceholder } from "./_components/view-config";

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

  const menuItems = (
    [
      ["videos", { view: "videos", channel: null }],
      ["channels", { view: "channels", channel: null }],
      ["liked", { view: "liked", channel: null }],
      ["playlists", { view: "playlists", channel: null, list: null }],
      [
        "history",
        { view: "history", channel: null, list: null, date: null },
      ],
    ] as const satisfies readonly (readonly [
      string,
      Partial<KidsFeedParams>,
    ])[]
  ).map(([key, overrides]) => ({
    key,
    label: KIDS_VIEWS[key].label,
    href: kidsPortalUrl(profileId, feed, overrides),
    active: view === key,
  }));

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
            list={feed.list}
            sort={feed.sort}
            dir={feed.dir}
            query={query}
            placeholder={searchPlaceholder(feed, profile.name)}
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
        {/* View picker — the five feeds live in a burger menu so the row
            stays one element wide on phones */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 mb-8">
          <KidsViewMenu items={menuItems} />
        </div>

        <Suspense fallback={<VideoGridSkeleton />}>
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
