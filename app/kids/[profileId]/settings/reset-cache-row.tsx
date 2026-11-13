"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowsClockwise,
  Check,
  SpinnerGap,
} from "@phosphor-icons/react";
import { resetFeedCache } from "@/app/actions/profiles";
import { clearFeedSnapshots } from "@/lib/feed-memory";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Outcome = "idle" | "working" | "done" | "failed";

// "Reset cached data" settings row: clears every cache layer that
// can serve a stale feed — the server's feed:<profileId> data-cache
// tag (10-min unstable_cache TTL), this device's sessionStorage feed
// snapshots (saved order/rows/scroll), and the client router cache
// (staleTimes.dynamic) via router.refresh(). The next feed visit is
// rendered fresh by the backend; the user stays signed in.
export function ResetCacheRow({ profileId }: { profileId: string }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome>("idle");

  const reset = async () => {
    setOutcome("working");
    const result = await resetFeedCache(profileId);
    if (result.error) {
      setOutcome("failed");
      return;
    }
    clearFeedSnapshots(profileId);
    router.refresh();
    setOutcome("done");
  };

  return (
    <div className="mt-8 border-t-2 border-slate-100 pt-6">
      <p
        className={cn(
          "mb-3 text-sm font-black uppercase",
          "tracking-wide text-slate-400"
        )}
      >
        Cached data
      </p>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="touch"
          variant="outline"
          onClick={reset}
          disabled={outcome === "working"}
        >
          {outcome === "working" ? (
            <>
              <SpinnerGap className="animate-spin" />
              Resetting…
            </>
          ) : (
            <>
              <ArrowsClockwise weight="bold" />
              Reset cached data
            </>
          )}
        </Button>
        {outcome === "done" && (
          <p
            className={cn(
              "flex items-center gap-1 text-sm",
              "font-bold text-emerald-600"
            )}
          >
            <Check weight="bold" />
            Fresh data on next visit!
          </p>
        )}
        {outcome === "failed" && (
          <p className="text-sm font-medium text-destructive">
            Reset failed — try again later.
          </p>
        )}
      </div>
      <p className="mt-2 text-sm font-medium text-slate-400">
        Clears saved feed data so everything reloads fresh from the
        server. You stay signed in.
      </p>
    </div>
  );
}
