"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      // In dev, stale cached /_next/static chunks can serve old code.
      // Unregister any existing service worker and clear its caches.
      navigator.serviceWorker
        ?.getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()));
      caches
        ?.keys()
        .then((keys) => keys.forEach((k) => caches.delete(k)));
      return;
    }

    navigator.serviceWorker?.register("/sw.js");
  }, []);

  return null;
}
