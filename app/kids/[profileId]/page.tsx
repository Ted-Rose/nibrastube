import { Suspense } from "react";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { MusicNotes, UserSwitch } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import PusherListener from "@/components/pusher-listener";
import WatchFromTracker from "@/components/watch-from-tracker";
import DailySyncPing from "@/components/daily-sync-ping";
import { KidsFooterGate } from "@/components/kids-footer-gate";
import { KidLogoutButton } from "@/components/kid-logout-button";
import { KidsHeader } from "@/components/kids-header";
import { KidsSearch } from "@/components/kids-search";
import { KidsViewTabs } from "@/components/kids-view-tabs";
import { LinkPendingSpinner } from "@/components/link-pending-spinner";
import { VideoGridSkeleton } from "@/components/video-grid-skeleton";
import { getSession, isKidSession } from "@/lib/auth";
import { canViewProfile } from "@/lib/profiles";
import { cookies } from "next/headers";
import {
  kidsPortalUrl,
  parseKidsFeedParams,
  type KidsFeedParams,
  type KidsView,
} from "@/lib/kids-feed";
import { FeedContent } from "./_components/feed-content";
import {
  KIDS_VIEWS,
  searchPlaceholder,
  tabIcon,
} from "./_components/view-config";

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
  const { view, q: query } = feed;

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

  const tabs = (
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
      KidsView,
      Partial<KidsFeedParams>,
    ])[]
  ).map(([key, overrides]) => {
    const active = view === key;
    return {
      key,
      label: KIDS_VIEWS[key].label,
      href: kidsPortalUrl(profileId, feed, overrides),
      active,
      icon: tabIcon(key, active),
    };
  });

  return (
    <div className="min-h-screen bg-[#F0F4FF]">
      <PusherListener profileId={profileId} />
      <WatchFromTracker />
      <DailySyncPing />
      {/* Kids Header — row 1 (search, profile, parent gate) collapses
          into the tab strip on phones; see KidsHeader */}
      <KidsHeader
        row1={
          <>
            <Link
              href={`/kids/${profileId}`}
              className="hidden shrink-0 rounded-lg px-1 py-2 text-xl font-black text-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 md:block"
            >
              <LinkPendingSpinner
                size={20}
                weight="bold"
                fallback={<>NibrasTube</>}
              />
            </Link>
            <div className="min-w-0 flex-1">
              <KidsSearch
                query={query}
                placeholder={searchPlaceholder(feed, profile.name)}
              />
            </div>
            {/* Song catalog is public — a plain link is fine, no
                prefetch caveat like the auth-conditional /kids. */}
            <Link
              href="/songs"
              aria-label="Song catalog"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
            >
              <MusicNotes size={24} weight="bold" />
            </Link>
            {isKidSession(session) ? (
              // A kid session can't switch profiles — proxy bounces
              // /kids back to their own feed — so the identity renders
              // as a plain badge, not a dead link.
              <div className="flex shrink-0 items-center gap-3">
                <span className="hidden text-xl font-black text-slate-700 sm:block">
                  {profile.name}
                </span>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-4 border-primary bg-white text-2xl shadow-sm sm:h-14 sm:w-14 sm:text-3xl">
                  {profile.avatar}
                </div>
              </div>
            ) : (
              <Link
                href="/kids"
                aria-label="Switch profile"
                // /kids is auth-conditional: proxy.ts 307-redirects it
                // to /login on locked kid devices. A prefetched redirect
                // pollutes the router's segment cache and can replay on
                // later navigations — always resolve it fresh on click.
                prefetch={false}
                className="group flex shrink-0 items-center gap-3 rounded-2xl transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
              >
                 <span className="text-xl font-black text-slate-700 hidden sm:block">{profile.name}</span>
                 <div className="relative">
                   <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-2xl bg-white border-4 border-primary shadow-sm flex items-center justify-center text-2xl sm:text-3xl">
                      {profile.avatar}
                   </div>
                   <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center shadow-sm">
                     <LinkPendingSpinner
                       size={14}
                       weight="bold"
                       fallback={<UserSwitch size={14} weight="bold" />}
                     />
                   </div>
                 </div>
              </Link>
            )}
            {/* Kid sessions can never pass the PIN gate (verifyParentPin
                bounces them), so they get a Log out control instead of
                the dead lock icon — e.g. two kids sharing one tablet. */}
            {isKidSession(session) ? (
              <KidLogoutButton />
            ) : (
              <KidsFooterGate variant="icon" />
            )}
          </>
        }
        tabs={<KidsViewTabs tabs={tabs} />}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 mt-6 sm:mt-10">
        <Suspense fallback={<VideoGridSkeleton />}>
          <FeedContent profileId={profileId} feed={feed} />
        </Suspense>
      </main>
    </div>
  );
}
