"use client";

import { useEffect, useRef, useState } from "react";
import { SongCard } from "./song-card";
import type { FeedSong } from "@/lib/songs-feed";

// The catalog query caps at 240 rows but that's still a lot of cards —
// mount a window and grow it as the sentinel scrolls into view, same
// as the kids video grid.
const PAGE_SIZE = 48;

export function SongCatalogGrid({
  rows,
  userId,
  eagerCount = 4,
}: {
  rows: FeedSong[];
  // Session user's id — their own rows get the ⋮ delete menu.
  userId?: string | null;
  // Thumbnails of the first `eagerCount` cards load eagerly — they're
  // the ones visible without scrolling.
  eagerCount?: number;
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
        {rows.slice(0, visible).map((song, i) => (
          <SongCard
            key={song.id}
            song={song}
            userId={userId}
            eager={i < eagerCount}
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
            className="rounded-full bg-white px-8 py-3 text-lg font-bold text-slate-500 shadow-sm hover:text-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
          >
            Show more songs
          </button>
        </div>
      )}
    </>
  );
}
