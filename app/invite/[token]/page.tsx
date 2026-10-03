import { db } from "@/lib/db";
import { invites, profiles, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { acceptInvite } from "@/app/actions/invites";
import { notFound } from "next/navigation";
import Link from "next/link";

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const session = await getSession();
  
  const invite = await db.query.invites.findFirst({
    where: eq(invites.token, token),
  });

  if (!invite) notFound();

  // If already accepted, redirect to dashboard or show message
  if (invite.status !== "pending") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 p-4">
        <Card className="max-w-md w-full shadow-lg text-center">
          <CardHeader>
            <CardTitle>Invite Already Used</CardTitle>
            <CardDescription>This invitation has already been accepted or has expired.</CardDescription>
          </CardHeader>
          <CardFooter>
             <Link href="/parent/dashboard" className="w-full">
                <Button className="w-full">Go to Dashboard</Button>
             </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const kid = await db.query.profiles.findFirst({ where: eq(profiles.id, invite.profileId) });
  const fromParent = await db.query.users.findFirst({ where: eq(users.id, invite.fromParentId) });

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50 p-4">
      <Card className="max-w-md w-full shadow-xl border-t-4 border-t-primary">
        <CardHeader className="text-center">
          <div className="mx-auto w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center text-4xl mb-4 shadow-inner">
            🤝
          </div>
          <CardTitle className="text-2xl font-black">Accept Invitation</CardTitle>
          <CardDescription>Join the team managing {kid?.name}&apos;s videos</CardDescription>
        </CardHeader>
        <CardContent className="text-center space-y-6 py-6">
          <div className="space-y-2">
            <p className="text-lg text-slate-700">
              <span className="font-bold">{fromParent?.name}</span> ({fromParent?.email}) has invited you to manage <span className="font-bold text-primary">{kid?.name}</span>&apos;s whitelisted YouTube videos.
            </p>
          </div>
          
          {!session && (
            <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 text-amber-800 text-sm flex gap-3 items-start text-left">
              <span className="text-xl">⚠️</span>
              <p>You need to be logged in as a parent to accept this invite. If you don&apos;t have an account, create one first!</p>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <form action={acceptInvite.bind(null, token)} className="w-full">
            <SubmitButton size="lg" className="w-full h-14 text-xl font-bold shadow-lg hover:shadow-primary/20 transition-all" pendingLabel="Accepting…">
              {session ? "Accept Invitation" : "Login & Accept"}
            </SubmitButton>
          </form>
          {session && (
            <p className="text-xs text-center text-muted-foreground italic">
              Logged in as {session.user.email}
            </p>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
