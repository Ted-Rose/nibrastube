import { db } from "@/lib/db";
import { profiles, invites, sharedAccess } from "@/lib/db/schema";
import { getSession } from "@/lib/auth";
import { eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { createProfile, deleteProfile } from "@/app/actions/profiles";
import { SwipeToggle } from "@/components/profile-swipe-toggle";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Trash, Plus } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import { createInviteAction } from "@/app/actions/invites";

export default async function ProfilesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const kidProfiles = await db.query.profiles.findMany({
    where: eq(profiles.parentId, session.user.id),
  });

  // Fetch all invites for these profiles
  const allInvites = await db.query.invites.findMany({
    where: inArray(invites.profileId, kidProfiles.map(p => p.id))
  });

  // Fetch shared access
  const allShared = await db.query.sharedAccess.findMany({
    where: inArray(sharedAccess.profileId, kidProfiles.map(p => p.id))
  });

  // Profiles other parents shared with this user — editors get a smaller
  // card (no delete/invite) but can still manage videos and toggle swipe.
  const sharedWithMe = await db.query.sharedAccess.findMany({
    where: eq(sharedAccess.parentId, session.user.id)
  });
  const sharedProfiles = sharedWithMe.length > 0
    ? await db.query.profiles.findMany({
        where: inArray(profiles.id, sharedWithMe.map(s => s.profileId))
      })
    : [];

  return (
    <div className="container mx-auto py-6 sm:py-10 px-4">
      <div className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Manage Kids</h1>
        <p className="text-muted-foreground mt-2">Manage settings and content for your children</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
        {kidProfiles.map((profile) => (
          <Card key={profile.id} className="group overflow-hidden hover:shadow-lg transition-all duration-300 border-2 hover:border-primary/50">
            <CardHeader className="flex flex-row items-center space-x-4 pb-2">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-3xl shadow-inner group-hover:scale-110 transition-transform">
                {profile.avatar || "👶"}
              </div>
              <div>
                <CardTitle className="text-xl">{profile.name}</CardTitle>
                <CardDescription>Kid Profile</CardDescription>
              </div>
            </CardHeader>
            <CardFooter className="flex flex-col pt-4 border-t bg-muted/30 space-y-4">
              <div className="flex justify-between w-full">
                <Link href={`/parent/dashboard?profileId=${profile.id}`} className="w-full mr-2">
                  <Button className="w-full" variant="outline" size="touch">Manage Approved Videos</Button>
                </Link>
                <form action={async () => {
                  "use server";
                  await deleteProfile(profile.id);
                }}>
                  <SubmitButton variant="ghost" size="icon-touch" aria-label={`Delete ${profile.name}`} className="text-destructive hover:bg-destructive/10">
                    <Trash size={20} />
                  </SubmitButton>
                </form>
              </div>

              <div className="w-full pt-4 border-t border-slate-200">
                <SwipeToggle profileId={profile.id} enabled={profile.swipeEnabled} />
              </div>

              <div className="w-full pt-4 border-t border-slate-200">
                  <p className="text-xs font-bold text-slate-500 uppercase mb-2 tracking-widest">Share Access</p>
                  <form action={createInviteAction} className="flex gap-2 mb-4">
                     <input type="hidden" name="profileId" value={profile.id} />
                     <Input name="email" placeholder="Spouse's email..." className="h-10 text-sm" type="email" required />
                     <SubmitButton variant="secondary" className="h-10 px-4 text-sm" pendingLabel="…">Invite</SubmitButton>
                  </form>

                  <div className="space-y-2">
                    {/* List pending invites */}
                    {allInvites.filter(i => i.profileId === profile.id && i.status === "pending").map(invite => (
                      <div key={invite.id} className="flex justify-between items-center text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded border border-amber-100">
                        <span className="truncate max-w-[160px] sm:max-w-[200px]">{invite.email}</span>
                        <span className="uppercase font-bold opacity-70">Pending</span>
                      </div>
                    ))}

                    {/* List accepted access */}
                    {allShared.filter(s => s.profileId === profile.id).map(share => (
                      <div key={share.parentId + share.profileId} className="flex justify-between items-center text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded border border-blue-100">
                        <span className="truncate max-w-[160px] sm:max-w-[200px]">Shared with Editor</span>
                        <span className="uppercase font-bold opacity-70">Active</span>
                      </div>
                    ))}
                  </div>
               </div>
            </CardFooter>
          </Card>
        ))}

        <Card className="border-2 border-dashed flex flex-col items-center justify-center p-6 bg-muted/5 hover:bg-muted/10 transition-colors">
          <CardHeader className="text-center pb-2">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-2">
              <Plus size={32} className="text-muted-foreground" />
            </div>
            <CardTitle>Add New Kid</CardTitle>
          </CardHeader>
          <CardContent className="w-full">
            <form action={createProfile} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Kid's Name</Label>
                <Input id="name" name="name" placeholder="Adam" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="avatar">Avatar (Emoji)</Label>
                <Input id="avatar" name="avatar" placeholder="👦" defaultValue="👦" />
              </div>
              <SubmitButton className="w-full mt-4" size="touch" pendingLabel="Adding…">Add Kid</SubmitButton>
            </form>
          </CardContent>
        </Card>
      </div>

      {sharedProfiles.length > 0 && (
        <>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4">Shared With You</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sharedProfiles.map((profile) => (
              <Card key={profile.id} className="overflow-hidden border-2">
                <CardHeader className="flex flex-row items-center space-x-4 pb-2">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-3xl shadow-inner">
                    {profile.avatar || "👶"}
                  </div>
                  <div>
                    <CardTitle className="text-xl">{profile.name}</CardTitle>
                    <CardDescription>Shared profile</CardDescription>
                  </div>
                </CardHeader>
                <CardFooter className="flex flex-col pt-4 border-t bg-muted/30 space-y-4">
                  <Link href={`/parent/dashboard?profileId=${profile.id}`} className="w-full">
                    <Button className="w-full" variant="outline" size="touch">Manage Approved Videos</Button>
                  </Link>
                  <div className="w-full pt-4 border-t border-slate-200">
                    <SwipeToggle profileId={profile.id} enabled={profile.swipeEnabled} />
                  </div>
                </CardFooter>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
