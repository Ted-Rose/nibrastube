"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getPusherClient } from "@/lib/pusher";

export default function PusherListener({ profileId }: { profileId: string }) {
  const router = useRouter();

  useEffect(() => {
    const pusher = getPusherClient();
    const channel = pusher.subscribe(`profile-${profileId}`);

    channel.bind("video-pinned", () => {
      router.refresh();
    });

    channel.bind("video-unpinned", () => {
      router.refresh();
    });

    channel.bind("video-reacted", () => {
      router.refresh();
    });

    return () => {
      pusher.unsubscribe(`profile-${profileId}`);
    };
  }, [profileId, router]);

  return null;
}
