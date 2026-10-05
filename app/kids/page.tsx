import { getSession } from "@/lib/auth";
import { getManageableProfiles } from "@/lib/profiles";
import { redirect } from "next/navigation";
import { selectProfile } from "@/app/actions/safety";
import { KidsFooterGate } from "@/components/kids-footer-gate";
import { ProfilePickerButton } from "@/components/profile-picker-button";
import { AppInstallMenu } from "@/components/app-install-menu";
import Link from "next/link";

export default async function KidsPage() {
  // The picker is parent-only: proxy.ts bounces anonymous visitors to
  // /login?callback=/kids, and this is the server-side backstop.
  const session = await getSession();
  if (!session) redirect("/login?callback=/kids");

  // Only this family's profiles: owned + shared with the parent.
  const allProfiles = await getManageableProfiles(session.user.id);

  const gatePin = session.user.parentPin ?? "0000";

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
        <KidsFooterGate correctPin={gatePin} />
      </footer>
    </div>
  );
}
