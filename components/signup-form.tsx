"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup } from "@/app/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardContent, CardFooter } from "@/components/ui/card";

export function SignupForm({ callback }: { callback?: string }) {
  const [state, formAction] = useActionState(signup, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="callback" value={callback || ""} />
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Full Name</Label>
          <Input id="name" name="name" placeholder="John Doe" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" placeholder="m@example.com" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pin">Parental PIN (4 digits)</Label>
          <Input id="pin" name="pin" type="text" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="0000" required />
          <p className="text-xs text-muted-foreground">This PIN will be used to access parent settings and switch profiles.</p>
        </div>
        {state?.error && (
          <p className="text-sm font-medium text-destructive">{state.error}</p>
        )}
      </CardContent>
      <CardFooter className="flex flex-col space-y-4">
        <SubmitButton className="w-full h-12 text-lg" pendingLabel="Creating account…">
          Sign Up
        </SubmitButton>
        <div className="text-sm text-center text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline underline-offset-4 font-medium">
            Log in
          </Link>
        </div>
      </CardFooter>
    </form>
  );
}
