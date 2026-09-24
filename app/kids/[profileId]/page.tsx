import { db } from "@/lib/db";
import { profiles, whitelistedVideos, videos } from "@/lib/db/schema";
import { eq, and, ilike, inArray } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { Input } from "@/components/ui/input";
import { MagnifyingGlass, Play, House } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import PusherListener from "@/components/pusher-listener";
import DailySyncPing from "@/components/daily-sync-ping";
import { KidsFooterGate } from "@/components/kids-footer-gate";
import { getSession } from "@/lib/auth";

interface KidsPortalProps {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<{ q?: string }>;
}

export default async function KidsPortalPage({ params, searchParams }: KidsPortalProps) {
  const session = await getSession();
  const { profileId } = await params;

  // Basic UUID validation to prevent DB crash
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(profileId)) {
    redirect("/kids");
  }

  const { q } = await searchParams;
  const query = q || "";

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, profileId),
  });

  if (!profile) notFound();

  // Get pinned videos for this profile
  const pinnedRelations = await db.query.whitelistedVideos.findMany({
    where: eq(whitelistedVideos.profileId, profileId),
  });

  const pinnedVideoIds = pinnedRelations.map(r => r.videoId);

  let approvedVideos: any[] = [];
  if (pinnedVideoIds.length > 0) {
    approvedVideos = await db.query.videos.findMany({
      where: query 
        ? and(inArray(videos.id, pinnedVideoIds), ilike(videos.title, `%${query}%`))
        : inArray(videos.id, pinnedVideoIds),
    });
  }

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
              <Input 
                name="q"
                defaultValue={query}
                placeholder={`Search ${profile.name}'s videos...`} 
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
        <div className="flex items-center justify-between mb-8">
           <h2 className="text-3xl font-black text-slate-900 tracking-tight">
             {query ? `Results for "${query}"` : "Approved Videos"}
           </h2>
        </div>

        {approvedVideos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center bg-white rounded-[40px] shadow-sm border-4 border-slate-100">
             <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 mb-6">
                 <Play size={48} weight="fill" />
             </div>
             <p className="text-2xl font-bold text-slate-400">
               {query ? "No videos found!" : "Ask Mom or Dad to pick some videos!"}
             </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            {approvedVideos.map((video) => (
              <Link key={video.id} href={`/kids/${profileId}/watch/${video.id}`} className="group">
                <Card className="overflow-hidden border-0 shadow-lg rounded-[32px] group-hover:-translate-y-2 transition-transform duration-300 bg-white">
                  <div className="relative aspect-video">
                    <img src={video.thumbnail} className="w-full h-full object-cover" alt={video.title} />
                    <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-colors" />
                    <div className="absolute bottom-4 right-4 w-12 h-12 bg-primary rounded-full flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                       <Play weight="fill" color="white" size={24} />
                    </div>
                  </div>
                  <CardContent className="p-6">
                    <h3 className="text-xl font-bold line-clamp-2 leading-tight group-hover:underline">
                      {video.title}
                    </h3>
                    <p className="text-slate-500 mt-2 font-medium">{video.channelTitle}</p>
                  </CardContent>
                </Card>
              </Link>
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
