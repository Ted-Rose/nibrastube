"use client";

import { useOptimistic, useTransition } from "react";
import { setAutoplayEnabled } from "@/app/actions/profiles";
import { cn } from "@/lib/utils";

// Per-kid autoplay switches for the profile card — same optimistic
// pattern as SwipeToggle: the server action runs inside a transition
// and useOptimistic flips the thumb instantly, falling back to the
// revalidated prop when the action settles. "Off" is the
// history-friendly default: only plays started by a tap on the
// player's own button count toward YouTube watch history.
export function AutoplayToggles({
  profileId,
  autoplayOnOpen,
  autoplayOnNext,
}: {
  profileId: string;
  autoplayOnOpen: boolean;
  autoplayOnNext: boolean;
}) {
  return (
    <div className="mt-3 w-full space-y-3">
      <AutoplayRow
        profileId={profileId}
        field="open"
        enabled={autoplayOnOpen}
        label="Autoplay on open"
        description={
          "Starts the video by itself when the watch page opens. " +
          "Off keeps plays eligible for YouTube watch history."
        }
      />
      <AutoplayRow
        profileId={profileId}
        field="next"
        enabled={autoplayOnNext}
        label="Autoplay next"
        description={
          "Starts the next video by itself when the current one " +
          "ends. Off keeps plays eligible for YouTube watch history."
        }
      />
    </div>
  );
}

function AutoplayRow({
  profileId,
  field,
  enabled,
  label,
  description,
}: {
  profileId: string;
  field: "open" | "next";
  enabled: boolean;
  label: string;
  description: string;
}) {
  const [pending, startTransition] = useTransition();
  const [optimisticEnabled, setOptimisticEnabled] =
    useOptimistic(enabled);

  const toggle = () => {
    const next = !optimisticEnabled;
    startTransition(async () => {
      setOptimisticEnabled(next);
      const formData = new FormData();
      formData.set("profileId", profileId);
      formData.set("field", field);
      formData.set("enabled", String(next));
      await setAutoplayEnabled(formData);
    });
  };

  return (
    <div className="flex w-full items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-bold">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={optimisticEnabled}
        aria-label={label}
        disabled={pending}
        onClick={toggle}
        className={cn(
          "relative h-8 w-14 shrink-0 rounded-full transition-colors",
          "disabled:opacity-50",
          optimisticEnabled ? "bg-primary" : "bg-slate-300"
        )}
      >
        <span
          className={cn(
            "absolute top-1 h-6 w-6 rounded-full bg-white shadow",
            "transition-all",
            optimisticEnabled ? "left-7" : "left-1"
          )}
        />
      </button>
    </div>
  );
}
