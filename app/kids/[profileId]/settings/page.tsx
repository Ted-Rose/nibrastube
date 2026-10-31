import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { canViewProfile } from "@/lib/profiles";
import { BackLink } from "@/components/back-link";
import { AvatarPicker } from "./avatar-picker";
import { UpdateCheckRow } from "./update-check-row";

interface KidSettingsProps {
  params: Promise<{ profileId: string }>;
}

// Kid-facing profile settings — same access gate as the feed (matching
// kid session, activeProfileId lock, or managing parent) so no proxy.ts
// change is needed. Display name stays parent-managed: it renders as
// text with no editing control.
export default async function KidSettingsPage({
  params,
}: KidSettingsProps) {
  const { profileId } = await params;

  // Basic UUID validation to prevent DB crash
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(profileId)) {
    redirect("/kids");
  }

  // Access check before the existence check so a signed-in parent can't
  // use 404-vs-redirect to probe whether a profile UUID exists.
  const session = await getSession();
  const activeProfileId = (await cookies()).get("activeProfileId")?.value;
  if (!(await canViewProfile(session, profileId, activeProfileId))) {
    redirect("/kids");
  }

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, profileId),
  });

  if (!profile) notFound();

  return (
    <div className="min-h-screen bg-[#F0F4FF]">
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
        <BackLink href={`/kids/${profileId}`}>Back to videos</BackLink>
        <section className="rounded-[32px] bg-white p-6 shadow-sm sm:p-10">
          <h1 className="text-3xl font-black text-slate-900 sm:text-4xl">
            {profile.name}
          </h1>
          <p className="mb-8 mt-1 text-lg font-bold text-slate-400">
            Profile settings
          </p>
          <AvatarPicker
            profileId={profile.id}
            currentAvatar={profile.avatar || "👶"}
          />
          <UpdateCheckRow />
        </section>
      </main>
    </div>
  );
}
