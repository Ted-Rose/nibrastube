"use client";

import { useEffect } from "react";

const STORAGE_KEY = "nibrastube:lastSyncPing";

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Invisible component: pings the daily channel-sync endpoint at most once
 * per day per device. The server dedupes further via the daily_syncs table.
 */
export default function DailySyncPing() {
  useEffect(() => {
    const today = todayLocal();
    if (localStorage.getItem(STORAGE_KEY) === today) return;

    fetch("/api/sync-channels", { method: "POST" })
      .then((res) => {
        if (res.ok) localStorage.setItem(STORAGE_KEY, today);
      })
      .catch(() => {
        // Leave the key unset so the next app open retries
      });
  }, []);

  return null;
}
