"use client";

import { useActionState } from "react";
import { createProfile } from "@/app/actions/profiles";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// "Add New Kid" form — a server action bound via useActionState so
// validation/namespace errors surface instead of silently aborting.
export function ProfileCreateForm() {
  const [state, formAction] = useActionState(createProfile, null);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Kid&apos;s Name</Label>
        <Input id="name" name="name" placeholder="Adam" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="avatar">Avatar (Emoji)</Label>
        <Input
          id="avatar"
          name="avatar"
          placeholder="👦"
          defaultValue="�"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="username">Login username (optional)</Label>
        <Input
          id="username"
          name="username"
          placeholder="emma"
          minLength={3}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="kid-password">Login password (optional)</Label>
        <Input
          id="kid-password"
          name="password"
          type="password"
          placeholder="Min 4 characters"
          minLength={4}
        />
      </div>
      {state?.error && (
        <p className="text-sm font-medium text-destructive">
          {state.error}
        </p>
      )}
      <SubmitButton
        className="mt-4 w-full"
        size="touch"
        pendingLabel="Adding…"
      >
        Add Kid
      </SubmitButton>
    </form>
  );
}
