"use client";

import { useActionState } from "react";
import { setKidCredentials } from "@/app/actions/profiles";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";

interface KidCredentialsFormProps {
  profileId: string;
  // Current username — null when the profile has no login yet.
  username: string | null;
  // Whether a passwordHash exists — drives the password field's
  // `required` attr and the "blank = keep" placeholder.
  hasCredentials: boolean;
  name: string;
}

// Per-profile "Kid Login" form — useActionState so credential errors
// (taken username, short password) render instead of silently no-oping.
export function KidCredentialsForm({
  profileId,
  username,
  hasCredentials,
  name,
}: KidCredentialsFormProps) {
  const [state, formAction] = useActionState(setKidCredentials, null);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="profileId" value={profileId} />
      <Input
        name="username"
        placeholder="Username"
        defaultValue={username ?? ""}
        className="h-10 text-sm"
        minLength={3}
        aria-label={`${name}'s login username`}
      />
      <Input
        name="password"
        type="password"
        placeholder={
          hasCredentials
            ? "New password (blank = keep)"
            : "Password (min 4 chars)"
        }
        className="h-10 text-sm"
        minLength={4}
        required={!hasCredentials}
        aria-label={`${name}'s login password`}
      />
      {state?.error && (
        <p className="text-sm font-medium text-destructive">
          {state.error}
        </p>
      )}
      <SubmitButton
        variant="secondary"
        className="h-10 self-start px-4 text-sm"
        pendingLabel="…"
      >
        Save Login
      </SubmitButton>
      <p className="text-xs text-muted-foreground">
        Clear the username to remove {name}&apos;s login.
      </p>
    </form>
  );
}
