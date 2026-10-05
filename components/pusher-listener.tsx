"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getPusherClient } from "@/lib/pusher";

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

    return () => {
      if (timer) clearTimeout(timer);
      pusher.unsubscribe(`profile-${profileId}`);
    };
  }, [profileId, router]);

  return null;
}
