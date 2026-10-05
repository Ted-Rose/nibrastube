"use client";

import { useEffect, useRef, useState } from "react";
import { VideoCard } from "./video-card";
import type { watchProgress } from "@/lib/db/schema";
import type { FeedVideo, VideoReaction } from "@/lib/kids-feed";

export interface FeedRow {
  video: FeedVideo;
  progress: typeof watchProgress.$inferSelect | null;
  reaction: VideoReaction | null;
}

// Approved feeds can hold ~2k videos; mounting every card at once made the
// DOM (and each pusher-driven re-render) expensive on kid devices. Mount a
// window and grow it as the sentinel scrolls into view.
const PAGE_SIZE = 48;

export function KidsVideoGrid({
  rows,
  profileId,
  feedQuery,
}: {
  rows: FeedRow[];
  profileId: string;
  feedQuery: string;
}) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasMore = visible < rows.length;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible((v) => Math.min(v + PAGE_SIZE, rows.length));
        }
      },
      { rootMargin: "600px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, rows.length]);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
        {rows.slice(0, visible).map(({ video, progress, reaction }) => (
          <VideoCard
            key={video.id}
            href={`/kids/${profileId}/watch/${video.id}${feedQuery}`}
            video={video}
            progress={progress}
            reaction={reaction}
          />
        ))}
      </div>
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center pt-8">
          <button
            type="button"
            onClick={() =>
              setVisible((v) => Math.min(v + PAGE_SIZE, rows.length))
            }
            className="rounded-full bg-white px-8 py-3 text-lg font-bold text-slate-500 shadow-sm hover:text-slate-800 transition-colors"
          >
            Show more videos
          </button>
        </div>
      )}
    </>
  );
}
