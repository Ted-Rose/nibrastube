"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login } from "@/app/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardContent, CardFooter } from "@/components/ui/card";

export function LoginForm({ callback }: { callback?: string }) {
  const [state, formAction] = useActionState(login, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="callback" value={callback || ""} />
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" placeholder="m@example.com" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" required />
        </div>
        {state?.error && (
          <p className="text-sm font-medium text-destructive">{state.error}</p>
        )}
      </CardContent>
      <CardFooter className="flex flex-col space-y-4">
        <SubmitButton className="w-full h-12 text-lg" pendingLabel="Logging in…">
          Log In
        </SubmitButton>
        <div className="text-sm text-center text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-primary hover:underline underline-offset-4 font-medium">
            Sign up
          </Link>
        </div>
      </CardFooter>
    </form>
  );
}
