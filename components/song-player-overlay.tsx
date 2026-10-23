"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, MusicNotes, X } from "@phosphor-icons/react";
import { FullscreenPlayer } from "@/components/fullscreen-player";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SongQueueEntry } from "@/lib/songs-feed";
import {
  ensureYouTubeAPI,
  loadedVideoId,
  YT_MOUNT_CLASS,
  type YTPlayer,
} from "@/lib/yt-player";

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
  const playerRef = useRef<YTPlayer | null>(null);
  const advancingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // Held until onReady publishes it to playerRef — the API methods
    // don't exist before then.
    let createdPlayer: YTPlayer | null = null;

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
    const finishSong = () => {
      if (advancingRef.current) return;
      advancingRef.current = true;
      if (indexRef.current + 1 < queue.length) {
        goTo(indexRef.current + 1);
      } else {
        close();
      }
    };

    const createPlayer = () => {
      const container = containerRef.current;
      if (cancelled || !container || !window.YT?.Player) return;
      // The YT API replaces the mount node with its iframe — after a
      // StrictMode remount the old node is detached, so create a
      // fresh one (same guard as watch-experience).
      if (!mountRef.current || !mountRef.current.isConnected) {
        const el = document.createElement("div");
        el.className = YT_MOUNT_CLASS;
        container.appendChild(el);
        mountRef.current = el;
      }
      const cur = queue[indexRef.current];
      if (!cur) return;
      const end = cur.endSeconds ?? undefined;
      createdPlayer = new window.YT.Player(mountRef.current, {
        videoId: cur.videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 1,
          modestbranding: 1,
          rel: 0,
          iv_load_policy: 3,
          controls: 1,
          playsinline: 1,
          start: cur.startSeconds,
          ...(end !== undefined ? { end } : {}),
        },
        events: {
          onReady: () => {
            if (cancelled || !createdPlayer) return;
            playerRef.current = createdPlayer;
            // A finishSong() during init skipped its loadVideoById
            // (the ref was still null) — catch up if the index moved
            // meanwhile.
            const want = queue[indexRef.current];
            if (want.id !== cur.id) {
              createdPlayer.loadVideoById({
                videoId: want.videoId,
                startSeconds: want.startSeconds,
                endSeconds: want.endSeconds ?? undefined,
              });
            }
          },
          onStateChange: (event) => {
            if (event.data === window.YT?.PlayerState.PLAYING) {
              advancingRef.current = false;
            }
            if (event.data === window.YT?.PlayerState.ENDED) {
              finishSong();
            }
          },
        },
      });
    };

    ensureYouTubeAPI(createPlayer);

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

    return () => {
      cancelled = true;
      window.clearInterval(tick);
      window.removeEventListener("keydown", onKeyDown);
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
  }, [queue, closeHref, router]);

  // Clamp at render too: a server-driven queue change can leave
  // `index` pointing past the new end until the effect re-seeds.
  const current = queue[Math.min(index, queue.length - 1)];
  if (!current) return null;
  const next = queue[index + 1];

  const start = formatDuration(current.startSeconds) ?? "0:00";
  const endLabel =
    formatDuration(current.endSeconds ?? current.videoDuration) ??
    "end";

  return (
    // KNOWN ISSUE: this `fixed inset-0` root is the same pattern that
    // desyncs OOPIF touch hit-regions around the YouTube iframe on real
    // mobile engines (WebKit bug 261390 — dead embed controls). As a
    // genuine modal, converting it to document flow is a design
    // decision; pending that, the body scroll-lock was dropped so no
    // overflow-locking layer is added around the iframe.
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

      {/* Video player area — FullscreenPlayer gives the same player
          chrome as the watch page (fullscreen only via the embed's own
          ⛶, never auto-requested). min-h-0 lets the area shrink below
          the iframe's min-content height instead of clipping inside
          this fixed modal; the md padding is height-gated for
          landscape phones (same as the watch page). */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 md:[@media(min-height:480px)]:p-10">
        <FullscreenPlayer>
          <div ref={containerRef} className="h-full w-full">
            {/* YT_MOUNT_CLASS transfers to the iframe when the YT API
                replaces this mount div (same as the watch page) — see
                lib/yt-player.ts. */}
            <div ref={mountRef} className={YT_MOUNT_CLASS} />
          </div>
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
