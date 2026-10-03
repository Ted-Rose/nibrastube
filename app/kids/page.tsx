import { getSession } from "@/lib/auth";
import { getManageableProfiles } from "@/lib/profiles";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { selectProfile } from "@/app/actions/safety";
import { KidsFooterGate } from "@/components/kids-footer-gate";
import { AppInstallMenu } from "@/components/app-install-menu";
import Link from "next/link";

export default async function KidsPage({
  searchParams,
}: {
  searchParams: Promise<{ gate?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { gate } = await searchParams;
  const allProfiles = await getManageableProfiles(session.user.id);
  // Presence is enough for this UI decision; proxy.ts does the real
  // signature check on /parent/* navigation.
  const parentUnlocked = !!(await cookies()).get("parentUnlocked");

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-4">
      {/* Inline rather than fixed so it can't cover the profile grid on
          scroll */}
      <div className="w-full max-w-5xl flex justify-end pt-[env(safe-area-inset-top)]">
        <AppInstallMenu />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center w-full">
        <h1 className="text-4xl md:text-6xl font-black text-slate-900 mb-12 text-center tracking-tight">
          Who&apos;s watching?
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
      </div>

      {/* Inline instead of a fixed overlay so it can never cover content.
          gate=1 (set when /parent/* redirects here) auto-opens the PIN
          modal unless the device is already unlocked. The key remounts
          the gate on same-page client navigations to/from ?gate=1 so a
          stale open/closed state can't linger. */}
      <footer className="py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <KidsFooterGate
          key={gate === "1" ? "gated" : "idle"}
          defaultOpen={gate === "1" && !parentUnlocked}
        />
      </footer>
    </div>
  );
}
