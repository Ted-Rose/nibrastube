"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "@phosphor-icons/react";
import { formatDuration } from "@/lib/format";
import type { FeedSong } from "@/lib/songs-feed";
import {
  ensureYouTubeAPI,
  loadedVideoId,
  type YTPlayer,
} from "@/lib/yt-player";

// In-app segment player for ?song=<uuid> — the catalog card click stays
// on the page: the overlay mounts an IFrame-API player seeked to the
// song's range, plays to `end` (or the video's end), then closes by
// navigating back to the feed URL. Escape, the X and the backdrop do
// the same. Like WatchExperience, a "More videos" tap inside the embed
// is snapped back to the song's segment rather than allowed to drift
// onto arbitrary YouTube content — the catalog is reachable from the
// kids portal, so the embed gets the same guard.
export function SongPlayerOverlay({
  song,
  closeHref,
}: {
  song: FeedSong;
  // The feed URL without ?song= — closing is a deterministic
  // navigation, not history.back(), so a shared ?song= link can't
  // strand the visitor on a site exit.
  closeHref: string;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Held until onReady publishes it to playerRef — the API methods
    // don't exist before then.
    let createdPlayer: YTPlayer | null = null;
    const end = song.endSeconds ?? undefined;

    const createPlayer = () => {
      const container = containerRef.current;
      if (cancelled || !container || !window.YT?.Player) return;
      // The YT API replaces the mount node with its iframe — after a
      // StrictMode remount the old node is detached, so create a fresh
      // one (same guard as watch-experience).
      if (!mountRef.current || !mountRef.current.isConnected) {
        const el = document.createElement("div");
        el.className = "w-full h-full";
        container.appendChild(el);
        mountRef.current = el;
      }
      createdPlayer = new window.YT.Player(mountRef.current, {
        videoId: song.videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 1,
          modestbranding: 1,
          rel: 0,
          iv_load_policy: 3,
          controls: 1,
          playsinline: 1,
          start: song.startSeconds,
          ...(end !== undefined ? { end } : {}),
        },
        events: {
          onReady: () => {
            if (cancelled || !createdPlayer) return;
            playerRef.current = createdPlayer;
          },
          onStateChange: (event) => {
            if (event.data === window.YT?.PlayerState.ENDED) {
              router.push(closeHref, { scroll: false });
            }
          },
        },
      });
    };

    ensureYouTubeAPI(createPlayer);

    // 500ms poll: snap a rogue suggested-video load back to the song's
    // segment, and close once the playhead reaches the segment end
    // (covers the `end` param firing PAUSED rather than ENDED).
    const tick = window.setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      const loadedId = loadedVideoId(p);
      if (loadedId && loadedId !== song.videoId) {
        p.loadVideoById({
          videoId: song.videoId,
          startSeconds: song.startSeconds,
          endSeconds: end,
        });
        return;
      }
      if (
        end !== undefined &&
        p.getPlayerState() === window.YT?.PlayerState.PAUSED &&
        p.getCurrentTime() >= end - 0.5
      ) {
        router.push(closeHref, { scroll: false });
      }
    }, 500);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(closeHref, { scroll: false });
    };
    window.addEventListener("keydown", onKeyDown);
    // Keep the feed from scrolling behind the modal.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      cancelled = true;
      window.clearInterval(tick);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      const p = playerRef.current ?? createdPlayer;
      playerRef.current = null;
      createdPlayer = null;
      try {
        p?.destroy();
      } catch {
        // The API throws if destroy() races a not-yet-ready player.
      }
      mountRef.current = null;
    };
  }, [song, closeHref, router]);

  const start = formatDuration(song.startSeconds) ?? "0:00";
  const endLabel =
    formatDuration(song.endSeconds ?? song.videoDuration) ?? "end";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
      {/* Backdrop is a real link — clicking it closes the overlay. */}
      <Link
        href={closeHref}
        scroll={false}
        aria-label="Close player"
        className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-4xl overflow-hidden rounded-[32px] bg-white shadow-2xl">
        <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-black leading-tight text-slate-900 sm:text-xl">
              {song.title}
            </h2>
            <p className="truncate text-sm font-medium text-slate-500">
              {song.videoTitle}
              <span className="tabular-nums">
                {" "}
                · {start} – {endLabel}
              </span>
            </p>
          </div>
          <Link
            href={closeHref}
            scroll={false}
            aria-label="Close player"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
          >
            <X size={24} weight="bold" />
          </Link>
        </div>
        <div ref={containerRef} className="aspect-video w-full bg-black" />
      </div>
    </div>
  );
}
