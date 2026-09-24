import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { getSession } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { selectProfile } from "@/app/actions/safety";
import { KidsFooterGate } from "@/components/kids-footer-gate";
import Link from "next/link";

export default async function KidsPage() {
  const session = await getSession();
  
  const allProfiles = session 
    ? await db.query.profiles.findMany({ where: eq(profiles.parentId, session.user.id) })
    : await db.query.profiles.findMany();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <h1 className="text-4xl md:text-6xl font-black text-slate-900 mb-12 text-center tracking-tight">
        Who's watching?
      </h1>
      
      <div className="max-w-5xl w-full">
        {allProfiles.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-xl text-slate-500">No kids found. Go to the parent portal to add one!</p>
            <Link href="/parent/profiles" className="mt-4 inline-block text-primary font-bold hover:underline">
              Manage Kids
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8">
            {allProfiles.map((profile) => (
              <form key={profile.id} action={selectProfile.bind(null, profile.id)} className="group cursor-pointer">
                <button type="submit" className="w-full text-left bg-transparent border-0 p-0 hover:scale-105 transition-transform duration-300">
                  <Card className="border-0 shadow-none bg-transparent overflow-visible">
                    <CardContent className="p-0 flex flex-col items-center">
                      <div className="w-full aspect-square bg-white rounded-3xl shadow-xl border-4 border-transparent group-hover:border-primary flex items-center justify-center text-7xl md:text-8xl transition-colors">
                        {profile.avatar || "👶"}
                      </div>
                      <h2 className="mt-6 text-3xl font-black text-slate-800 group-hover:text-primary transition-colors">
                        {profile.name}
                      </h2>
                    </CardContent>
                  </Card>
                </button>
              </form>
            ))}
          </div>
        )}
      </div>

      <div className="fixed bottom-6 right-6">
        <KidsFooterGate correctPin={session?.user?.parentPin || "0000"} />
      </div>
    </div>
  );
}
