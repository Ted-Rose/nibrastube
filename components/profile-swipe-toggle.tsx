"use client";

import { useOptimistic, useTransition } from "react";
import { setSwipeEnabled } from "@/app/actions/profiles";
import { cn } from "@/lib/utils";

// Switch-style toggle for the profile card. Server action runs inside a
// transition; useOptimistic flips the thumb instantly and falls back to
// the revalidated prop when the action settles.
export function SwipeToggle({
  profileId,
  enabled,
}: {
  profileId: string;
  enabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(enabled);

  const toggle = () => {
    const next = !optimisticEnabled;
    startTransition(async () => {
      setOptimisticEnabled(next);
      const formData = new FormData();
      formData.set("profileId", profileId);
      formData.set("enabled", String(next));
      await setSwipeEnabled(formData);
    });
  };

  return (
    <div className="flex w-full items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-bold">Swipe to change videos</p>
        <p className="text-xs text-muted-foreground">
          Swipe right/up for the next video, left/down to go back.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={optimisticEnabled}
        aria-label="Swipe to change videos"
        disabled={pending}
        onClick={toggle}
        className={cn(
          "relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50",
          optimisticEnabled ? "bg-primary" : "bg-slate-300"
        )}
      >
        <span
          className={cn(
            "absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all",
            optimisticEnabled ? "left-7" : "left-1"
          )}
        />
      </button>
    </div>
  );
}
