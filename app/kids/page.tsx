import { db } from "@/lib/db";
import { profiles, users } from "@/lib/db/schema";
import { getSession } from "@/lib/auth";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { selectProfile } from "@/app/actions/safety";
import { KidsFooterGate } from "@/components/kids-footer-gate";
import { ProfilePickerButton } from "@/components/profile-picker-button";
import { AppInstallMenu } from "@/components/app-install-menu";
import Link from "next/link";

export default async function KidsPage() {
  const session = await getSession();
  
  const allProfiles = session 
    ? await db.query.profiles.findMany({ where: eq(profiles.parentId, session.user.id) })
    : await db.query.profiles.findMany();

  // The gate PIN must work on kid-locked devices with no/expired session, so
  // fall back to the PIN of the parent who owns the locked profile (or the
  // first listed profile) instead of blindly defaulting to "0000".
  const activeProfileId = (await cookies()).get("activeProfileId")?.value;
  let gatePin = session?.user?.parentPin ?? null;
  if (!gatePin) {
    const gateProfile =
      allProfiles.find((p) => p.id === activeProfileId) ?? allProfiles[0];
    if (gateProfile) {
      const owner = await db.query.users.findFirst({
        where: eq(users.id, gateProfile.parentId),
        columns: { parentPin: true },
      });
      gatePin = owner?.parentPin ?? null;
    }
  }

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
                <ProfilePickerButton name={profile.name} avatar={profile.avatar} />
              </form>
            ))}
          </div>
        )}
        </div>
      </div>

      {/* Inline instead of a fixed overlay so it can never cover content */}
      <footer className="py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <KidsFooterGate correctPin={gatePin ?? "0000"} />
      </footer>
    </div>
  );
}
