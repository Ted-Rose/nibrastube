"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getPusherClient } from "@/lib/pusher";
import { captureProviderException } from "@/lib/report";

export default function PusherListener({ profileId }: { profileId: string }) {
  const router = useRouter();

  useEffect(() => {
    const pusher = getPusherClient();
    const channel = pusher.subscribe(`profile-${profileId}`);

    // A channel backfill fires an event per sync run; each refresh
    // re-renders the whole feed, so coalesce bursts into one refresh
    // shortly after the last event instead of refreshing per event.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        router.refresh();
      }, 1500);
    };

    channel.bind("video-pinned", scheduleRefresh);
    channel.bind("video-unpinned", scheduleRefresh);
    channel.bind("video-reacted", scheduleRefresh);
    channel.bind("playlist-changed", scheduleRefresh);

    // pusher-js retries connection failures forever and never
    // throws — bind "error" so a lasting outage (bad key, Pusher
    // down) still leaves a warning-level trail in Sentry instead of
    // silently degrading real-time refreshes. It re-fires per
    // failed reconnect, so report once per mount: an outage floods
    // one event per device, not one per retry.
    let connectionErrorReported = false;
    const onConnectionError = (err: unknown) => {
      if (connectionErrorReported) return;
      connectionErrorReported = true;
      captureProviderException(
        err instanceof Error ? err : new Error("Pusher connection error"),
        "provider_error"
      );
    };
    pusher.connection.bind("error", onConnectionError);

    return () => {
      if (timer) clearTimeout(timer);
      pusher.connection.unbind("error", onConnectionError);
      pusher.unsubscribe(`profile-${profileId}`);
    };
  }, [profileId, router]);

  return null;
}
