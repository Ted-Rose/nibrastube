"use client";

import { useState, useSyncExternalStore } from "react";
import { Capacitor } from "@capacitor/core";
import {
  ArrowCircleDown,
  ArrowsClockwise,
  Check,
  SpinnerGap,
} from "@phosphor-icons/react";
import { checkForAppUpdate } from "@/lib/app-update";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Outcome =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "update"; apkUrl: string; versionName: string }
  | { kind: "current" }
  | { kind: "failed" };

// Native-APK-only settings row: a manual check bypasses the hourly
// throttle (force) and reports EVERY outcome inline — the launch-time
// auto check stays silent on current/error. Renders nothing on web;
// Capacitor.isNativePlatform() is false during SSR, so the row mounts
// only after the client confirms a native platform.
export function UpdateCheckRow() {
  // Server snapshot false → renders nothing during SSR/hydration;
  // the real value arrives on the first client re-render, so a
  // native device sees the row appear right after hydration.
  const native = useSyncExternalStore(
    () => () => {},
    () => Capacitor.isNativePlatform(),
    () => false
  );
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  if (!native) return null;

  const check = async () => {
    setOutcome({ kind: "checking" });
    const result = await checkForAppUpdate({ force: true });
    if (result.kind === "update") {
      setOutcome({
        kind: "update",
        apkUrl: result.apkUrl,
        versionName: result.versionName,
      });
    } else if (result.kind === "current") {
      setOutcome({ kind: "current" });
    } else {
      setOutcome({ kind: "failed" });
    }
  };

  return (
    <div className="mt-8 border-t-2 border-slate-100 pt-6">
      <p
        className={cn(
          "mb-3 text-sm font-black uppercase",
          "tracking-wide text-slate-400"
        )}
      >
        App updates
      </p>

      {outcome.kind === "update" ? (
        <div
          className={cn(
            "flex items-center gap-3 rounded-3xl border-2",
            "border-slate-100 bg-[#F0F4FF] p-4"
          )}
        >
          <ArrowCircleDown
            size={32}
            weight="fill"
            className="shrink-0 text-primary"
          />
          <div className="min-w-0 flex-1">
            <p className="font-black text-slate-800">New app version</p>
            <p className="truncate text-sm font-bold text-slate-500">
              {outcome.versionName || "A newer build is available"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.open(outcome.apkUrl, "_system")}
            className={cn(
              "shrink-0 rounded-2xl bg-primary px-4 py-2.5",
              "text-sm font-black text-primary-foreground"
            )}
          >
            Update
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="touch"
            variant="outline"
            onClick={check}
            disabled={outcome.kind === "checking"}
          >
            {outcome.kind === "checking" ? (
              <>
                <SpinnerGap className="animate-spin" />
                Checking…
              </>
            ) : (
              <>
                <ArrowsClockwise weight="bold" />
                Check for updates
              </>
            )}
          </Button>
          {outcome.kind === "current" && (
            <p
              className={cn(
                "flex items-center gap-1 text-sm",
                "font-bold text-emerald-600"
              )}
            >
              <Check weight="bold" />
              You&apos;re up to date!
            </p>
          )}
          {outcome.kind === "failed" && (
            <p className="text-sm font-medium text-destructive">
              Update check failed — try again later.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
