"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, MusicNotes, X } from "@phosphor-icons/react";
import { FullscreenPlayer } from "@/components/fullscreen-player";
import {
  useYouTubePlayer,
  type PlayerEvents,
  type PlayerLoad,
} from "@/components/player-hooks";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SongQueueEntry } from "@/lib/songs-feed";
import { loadedVideoId } from "@/lib/yt-player";

// In-app segment player for ?song=<uuid> — same chrome and playback
// model as the kids watch page: full-screen dark layout around a
// FullscreenPlayer, and a queue instead of a single video. Each song
// plays its startSeconds→endSeconds segment, then the SAME player
// loads the next feed row in place (the ?song= URL follows via
// replaceState, so a reload or shared link lands on the song actually
// playing); the queue's last song ends by closing back to the
// catalog. Escape and the header links close early. A "More videos"
// tap inside the embed is snapped back to the current segment — the
// catalog is reachable from the kids portal, so it gets the same
// guard as WatchExperience.
export function SongPlayerOverlay({
  queue,
  startIndex,
  closeHref,
}: {
  // Feed-order songs, trimmed to playback fields by the server
  // wrapper (app/songs/_components/song-overlay.tsx).
  queue: SongQueueEntry[];
  // queue position of the ?song= id — a mount-time seed only. The
  // server wrapper keys this component by song id, so another ?song=
  // (Back/Forward, a fresh link) remounts with a new startIndex.
  startIndex: number;
  // The feed URL without ?song= — closing is a deterministic
  // navigation, not history.back(), so a shared ?song= link can't
  // strand the visitor on a site exit.
  closeHref: string;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(startIndex);
  const indexRef = useRef(startIndex);
  const containerRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const advancingRef = useRef(false);
  // finishSong lives inside the effect (it closes over goTo/close);
  // this ref surfaces it to the player events created above.
  const finishRef = useRef<((code?: number) => void) | null>(null);

  const events = useMemo<PlayerEvents>(
    () => ({
      onStateChange: (event) => {
        if (event.data === window.YT?.PlayerState.PLAYING) {
          advancingRef.current = false;
        }
        if (event.data === window.YT?.PlayerState.ENDED) {
          finishRef.current?.();
        }
      },
      onError: (event) => {
        // A dead video never emits the PLAYING that releases
        // advancingRef — release it here so finishSong can skip
        // to the next song (or close at queue end).
        advancingRef.current = false;
        finishRef.current?.(event.data);
      },
    }),
    []
  );
  const getInitialLoad = useCallback((): PlayerLoad | null => {
    const cur = queue[indexRef.current];
    if (!cur) return null;
    return {
      key: cur.id,
      videoId: cur.videoId,
      startSeconds: cur.startSeconds,
      endSeconds: cur.endSeconds ?? undefined,
    };
  }, [queue]);
  // A finishSong() during init skipped its loadVideoById (the ref
  // was still null) — catch up if the index moved meanwhile.
  const getCatchUpLoad = useCallback(
    (initial: PlayerLoad): PlayerLoad | null => {
      const want = queue[indexRef.current];
      if (!want || want.id === initial.key) return null;
      return {
        key: want.id,
        videoId: want.videoId,
        startSeconds: want.startSeconds,
        endSeconds: want.endSeconds ?? undefined,
      };
    },
    [queue]
  );
  const { playerRef, loadFailed } = useYouTubePlayer({
    containerRef,
    mountRef,
    events,
    getInitialLoad,
    getCatchUpLoad,
  });

  useEffect(() => {
    const joiner = closeHref.includes("?") ? "&" : "?";
    const urlFor = (id: string) => `${closeHref}${joiner}song=${id}`;
    const close = () => router.push(closeHref, { scroll: false });

    // Switch to another queue position by loading it into the SAME
    // player instead of navigating — keeps the element (and
    // fullscreen mode) mounted. Shared by autoplay and the end poll.
    const goTo = (next: number) => {
      const s = queue[next];
      if (!s) return;
      indexRef.current = next;
      setIndex(next);
      playerRef.current?.loadVideoById({
        videoId: s.videoId,
        startSeconds: s.startSeconds,
        endSeconds: s.endSeconds ?? undefined,
      });
      window.history.replaceState(null, "", urlFor(s.id));
    };

    // The segment (or whole video, for open-ended songs) finished —
    // play the next queue entry, or exit when the queue is done.
    const finishSong = (code?: number) => {
      // Only the player's onError carries a code; ENDED and the
      // end-poll call this bare. A permanent failure (100/101/150)
      // flags the video so suitableVideo hides it on every surface.
      // cur.id is the song uuid — flag the YouTube videoId, and the
      // one the embed actually loaded at that: a rogue suggested
      // video's id just 403s harmlessly server-side (or 404s where
      // no whitelist check applies).
      if (code === 100 || code === 101 || code === 150) {
        const p = playerRef.current;
        const videoId =
          (p ? loadedVideoId(p) : undefined) ??
          queue[indexRef.current]?.videoId;
        if (videoId) {
          fetch("/api/video-errors", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoId, code }),
          }).catch(() => {});
        }
      }
      if (advancingRef.current) return;
      advancingRef.current = true;
      if (indexRef.current + 1 < queue.length) {
        goTo(indexRef.current + 1);
      } else {
        close();
      }
    };
    finishRef.current = finishSong;

    // 500ms poll: snap a rogue suggested-video load back to the
    // current segment, and advance once the playhead reaches the
    // segment end — the `end` param can fire PAUSED rather than
    // ENDED, and a 500ms poll can straddle the boundary while the
    // state is still PLAYING.
    const tick = window.setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      const cur = queue[indexRef.current];
      if (!cur) return;
      const loadedId = loadedVideoId(p);
      if (loadedId && loadedId !== cur.videoId) {
        p.loadVideoById({
          videoId: cur.videoId,
          startSeconds: cur.startSeconds,
          endSeconds: cur.endSeconds ?? undefined,
        });
        return;
      }
      const end = cur.endSeconds;
      if (end == null) return;
      const state = p.getPlayerState();
      const time = p.getCurrentTime();
      if (
        (state === window.YT?.PlayerState.PAUSED &&
          time >= end - 0.5) ||
        (state === window.YT?.PlayerState.PLAYING && time >= end - 0.4)
      ) {
        finishSong();
      }
    }, 500);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    // Keep the feed from scrolling behind the player.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.clearInterval(tick);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      finishRef.current = null;
    };
  }, [queue, closeHref, router, playerRef]);

  // Clamp at render too: a server-driven queue change can leave
  // `index` pointing past the new end until the effect re-seeds.
  const curIndex = Math.min(index, queue.length - 1);
  const current = queue[curIndex];
  if (!current) return null;
  const next = queue[curIndex + 1];

  const start = formatDuration(current.startSeconds) ?? "0:00";
  const endLabel =
    formatDuration(current.endSeconds ?? current.videoDuration) ??
    "end";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Player header — same chrome as the kids watch page. */}
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-b",
          "border-slate-800 bg-slate-900/80 px-3 pb-3 text-white",
          "backdrop-blur sm:px-6 sm:pb-4",
          "pt-[max(0.75rem,env(safe-area-inset-top))]",
          "sm:pt-[max(1rem,env(safe-area-inset-top))]"
        )}
      >
        <Link
          href={closeHref}
          scroll={false}
          aria-label="Back to songs"
        >
          <Button
            variant="ghost"
            className={cn(
              "h-11 gap-2 px-3 text-white hover:bg-slate-800 sm:h-9"
            )}
          >
            <ArrowLeft size={24} weight="bold" />
            <span className="hidden text-lg font-bold sm:inline">
              Back to Songs
            </span>
          </Button>
        </Link>

        <div className="min-w-0 flex-1 px-2 text-center">
          <h1 className="max-w-full truncate text-base font-bold sm:text-xl">
            {current.title}
          </h1>
        </div>

        <Link
          href={closeHref}
          scroll={false}
          aria-label="Close player"
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-2xl",
            "bg-white/10 transition-colors hover:bg-white/20",
            "sm:h-12 sm:w-12"
          )}
        >
          <X size={24} weight="bold" />
        </Link>
      </div>

      {/* Video player area — FullscreenPlayer gives the same
          auto-fullscreen behavior as the watch page. An iframe_api
          load timeout overlays a notice on the still-mounted player
          so a late API arrival self-clears via onReady; the header
          links and Escape still close. */}
      <div className="flex flex-1 items-center justify-center p-4 md:p-10">
        <FullscreenPlayer>
          <div ref={containerRef} className="h-full w-full">
            <div ref={mountRef} className="h-full w-full" />
          </div>
          {/* Opaque notice OVER the player, not a swap — unmounting
              containerRef would null the ref and make the timeout's
              onReady self-clear unreachable. */}
          {loadFailed && (
            <div
              className={cn(
                "absolute inset-0 z-50 flex flex-col",
                "items-center justify-center gap-3",
                "bg-slate-900 px-6 text-center"
              )}
            >
              <p className="text-xl font-black text-white sm:text-2xl">
                Can&apos;t reach YouTube
              </p>
              <p
                className={cn(
                  "max-w-md text-sm font-medium text-slate-400",
                  "sm:text-base"
                )}
              >
                Check the connection, then close and reopen the song.
              </p>
            </div>
          )}
        </FullscreenPlayer>
      </div>

      {/* Bottom bar — mirrors the watch page's "Watching as" block. */}
      <div
        className={cn(
          "flex flex-col items-center gap-4 bg-slate-900/50 p-4",
          "pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-8",
          "sm:pb-[max(2rem,env(safe-area-inset-bottom))]"
        )}
      >
        <div className="flex items-center gap-4 sm:gap-10">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center",
                "rounded-3xl border-4 border-primary bg-white",
                "text-primary shadow-lg sm:h-16 sm:w-16"
              )}
            >
              <MusicNotes size={30} weight="fill" />
            </div>
            <div className="min-w-0 text-white">
              <p
                className={cn(
                  "text-xs font-bold uppercase tracking-widest",
                  "text-slate-400 sm:text-sm"
                )}
              >
                Now playing · {start} – {endLabel}
              </p>
              <p
                className={cn(
                  "max-w-[52vw] truncate text-xl font-black",
                  "sm:text-2xl"
                )}
              >
                {current.title}
              </p>
            </div>
          </div>

          <div className="hidden h-10 w-[2px] bg-slate-800 md:block" />

          <p
            className={cn(
              "hidden max-w-sm truncate text-lg font-medium",
              "text-slate-400 md:block"
            )}
          >
            {next ? `Up next: ${next.title}` : current.videoTitle}
          </p>
        </div>
      </div>
    </div>
  );
}
