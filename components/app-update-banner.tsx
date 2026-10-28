"use client";

import { ArrowCircleDown, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { checkForAppUpdate } from "@/lib/app-update";

type PendingUpdate = {
  apkUrl: string;
  versionName: string;
};

const cardClass =
  "fixed inset-x-4 z-50 mx-auto flex max-w-md items-center gap-3 " +
  "rounded-3xl border-2 border-slate-100 bg-white p-4 shadow-2xl";
const updateButtonClass =
  "shrink-0 rounded-2xl bg-primary px-4 py-2.5 text-sm font-black " +
  "text-primary-foreground";
const dismissButtonClass =
  "shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-slate-100";

// Fixed bottom card shown once per launch (hourly-throttled inside
// checkForAppUpdate) when the `continuous` release has a newer
// versionCode. Renders nothing on web, while throttled, or when the
// manifest check fails. Dismiss is React state only — the banner
// returns on next app launch.
export function AppUpdateBanner() {
  const [update, setUpdate] = useState<PendingUpdate | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    checkForAppUpdate().then((result) => {
      if (!cancelled && result.kind === "update") {
        setUpdate({
          apkUrl: result.apkUrl,
          versionName: result.versionName,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update || dismissed) return null;

  return (
    <div
      role="status"
      className={cardClass}
      style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
    >
      <ArrowCircleDown
        size={32}
        weight="fill"
        className="shrink-0 text-primary"
      />
      <div className="min-w-0 flex-1">
        <p className="font-black text-slate-800">New app version</p>
        <p className="truncate text-sm font-bold text-slate-500">
          {update.versionName || "A newer build is available"}
        </p>
      </div>
      <button
        type="button"
        onClick={() => window.open(update.apkUrl, "_system")}
        className={updateButtonClass}
      >
        Update
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss update"
        className={dismissButtonClass}
      >
        <X size={18} weight="bold" />
      </button>
    </div>
  );
}
