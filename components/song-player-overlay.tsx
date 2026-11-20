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
import {
  ArrowLeft,
  MusicNotes,
  ThumbsDown,
  ThumbsUp,
  X,
} from "@phosphor-icons/react";
import { FullscreenPlayer } from "@/components/fullscreen-player";
import {
  useYouTubePlayer,
  type PlayerEvents,
  type PlayerLoad,
} from "@/components/player-hooks";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SongQueueEntry, SongReaction } from "@/lib/songs-feed";
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
  profileId,
  closeHref,
}: {
  // Feed-order songs, trimmed to playback fields by the server
  // wrapper (app/songs/_components/song-overlay.tsx).
  queue: SongQueueEntry[];
  // queue position of the ?song= id — a mount-time seed only. The
  // server wrapper keys this component by song id, so another ?song=
  // (Back/Forward, a fresh link) remounts with a new startIndex.
  startIndex: number;
  // The profile reaction writes attach to (kid session or lock
  // cookie). Null hides the like/dislike buttons — anonymous visitors
  // and lockless parents have nothing to write against.
  profileId: string | null;
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

  // Any server-driven re-render can land a rebuilt, content-
  // identical queue prop — hand the player a list stabilized on the
  // id sequence, not prop identity, so a refresh can't tear the
  // iframe down and rebuild it. Reaction values live in the local
  // map below, so the signature only needs the ids; a stale
  // startSeconds/title snapshot wins, same accepted trade-off as
  // WatchExperience's playlist signature.
  const signature = queue.map((s) => s.id).join("|");
  const [stable, setStable] = useState({ signature, list: queue });
  if (stable.signature !== signature) {
    setStable({ signature, list: queue });
  }
  const stableQueue = stable.list;

  // The actually-playing song, tracked BY ID — a refreshed queue can
  // reorder or drop rows (disliking on the Liked tab removes the
  // playing row), and indexRef alone would then point at the wrong
  // slot or past the new end.
  const playingIdRef = useRef(stableQueue[startIndex]?.id);

  // Per-song reaction keyed by song id — seeded from the queue and
  // optimistically updated on tap. `committed` tracks the last
  // server-acknowledged value so a failed write reverts to what the
  // DB actually holds, not to an equally-unconfirmed earlier tap.
  const [reactions, setReactions] = useState(
    () =>
      new Map<string, SongReaction | null>(
        queue.map((s) => [s.id, s.reaction])
      )
  );
  const reactionsRef = useRef(reactions);
  const committedRef = useRef(new Map(reactions));
  // Reaction writes serialize per song: two rapid taps must reach
  // the server in tap order (last-arrival wins) and must not revert
  // each other's optimistic state.
  const writeChainRef = useRef(new Map<string, Promise<void>>());
  // Committed writes mark the feed data stale — but refreshing mid-
  // playback re-renders the RSC tree for the current ?song= URL,
  // which auto-advance already moved past the mounted key: the keyed
  // remount would destroy the player and restart the song paused.
  // The grid is invisible until the overlay closes anyway, so the
  // refresh is flushed on close/unmount instead.
  const pendingRefreshRef = useRef(false);
  const flushPendingRefresh = useCallback(() => {
    if (pendingRefreshRef.current) {
      pendingRefreshRef.current = false;
      router.refresh();
    }
  }, [router]);
  // Exits that don't pass through close() — Back/Forward to a
  // non-song URL, a tab link, a keyed remount — unmount the overlay
  // and flush the refresh here.
  useEffect(() => () => flushPendingRefresh(), [flushPendingRefresh]);

  // A server-driven queue change merges rows by id: NEW ids seed
  // both maps, and rows with no pending optimistic write take the
  // server's value — a reaction tapped on another device reaches us
  // through a refresh. A locally-pending tap (optimistic value not
  // yet committed) keeps its state either way.
  useEffect(() => {
    let changed = false;
    for (const s of stableQueue) {
      const local = reactionsRef.current.get(s.id);
      const pending = local !== committedRef.current.get(s.id);
      if (!pending && local !== s.reaction) {
        reactionsRef.current.set(s.id, s.reaction);
        committedRef.current.set(s.id, s.reaction);
        changed = true;
      }
    }
    if (changed) setReactions(new Map(reactionsRef.current));
  }, [stableQueue]);

  // Re-follow the playing song when the queue's contents shift —
  // otherwise a refresh that reorders or shrinks the queue leaves
  // indexRef pointing at the wrong row (or past the end, where no
  // player would ever be created). Same pattern as the watch page's
  // playlist re-follow.
  useEffect(() => {
    const idx = stableQueue.findIndex(
      (s) => s.id === playingIdRef.current
    );
    if (idx !== -1) {
      indexRef.current = idx;
    } else {
      // The playing song left the queue entirely — clamp to the
      // last reachable row; the loaded audio keeps playing, the
      // display just follows the nearest entry.
      indexRef.current = Math.max(0, stableQueue.length - 1);
      playingIdRef.current = stableQueue[indexRef.current]?.id;
    }
    setIndex(indexRef.current);
  }, [stableQueue]);

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
    const cur = stableQueue[indexRef.current];
    if (!cur) return null;
    return {
      key: cur.id,
      videoId: cur.videoId,
      startSeconds: cur.startSeconds,
      endSeconds: cur.endSeconds ?? undefined,
    };
  }, [stableQueue]);
  // A finishSong() during init skipped its loadVideoById (the ref
  // was still null) — catch up if the index moved meanwhile.
  const getCatchUpLoad = useCallback(
    (initial: PlayerLoad): PlayerLoad | null => {
      const want = stableQueue[indexRef.current];
      if (!want || want.id === initial.key) return null;
      return {
        key: want.id,
        videoId: want.videoId,
        startSeconds: want.startSeconds,
        endSeconds: want.endSeconds ?? undefined,
      };
    },
    [stableQueue]
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
    const close = () => {
      // Flush before navigating so the push can't land on the stale
      // cached payload the write(s) invalidated.
      flushPendingRefresh();
      router.push(closeHref, { scroll: false });
    };

    // Switch to another queue position by loading it into the SAME
    // player instead of navigating — keeps the element (and
    // fullscreen mode) mounted. Shared by autoplay and the end poll.
    const goTo = (next: number) => {
      const s = stableQueue[next];
      if (!s) return;
      indexRef.current = next;
      setIndex(next);
      playingIdRef.current = s.id;
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
          stableQueue[indexRef.current]?.videoId;
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
      if (indexRef.current + 1 < stableQueue.length) {
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
      const cur = stableQueue[indexRef.current];
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
  }, [stableQueue, closeHref, router, playerRef, flushPendingRefresh]);

  // Clamp at render too: a server-driven queue change can leave
  // `index` pointing past the new end until the effect re-seeds.
  const curIndex = Math.min(index, stableQueue.length - 1);
  const current = stableQueue[curIndex];

  // Toggle a reaction on the song at the queue's playing position —
  // indexRef leads the render `index` in the ~one-render gap after
  // goTo, so the write targets the song the player actually loaded
  // (same reason the watch page reacts on latestRef, not current).
  // Optimistic update; a failed write reverts to the last committed
  // value, and only if this tap's optimistic value is still current
  // (a newer tap may have landed while the write was in flight).
  const react = (dir: SongReaction) => {
    if (!profileId) return;
    const songId = stableQueue[indexRef.current]?.id;
    if (!songId) return;
    const prev = reactionsRef.current.get(songId) ?? null;
    const next = prev === dir ? null : dir;
    reactionsRef.current.set(songId, next);
    setReactions(new Map(reactionsRef.current));
    // Route handler, not a server action: an action's revalidation
    // re-renders this route, which would destroy and recreate the
    // YouTube player on every tap. Writes chain per song so rapid
    // taps reach the server in order; success flags the feed data
    // stale — router.refresh() can't run mid-playback (see
    // pendingRefreshRef above), so it's deferred to close/unmount.
    const prior = writeChainRef.current.get(songId) ?? Promise.resolve();
    const write = prior
      .then(() =>
        fetch("/api/song-reactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profileId,
            songId,
            reaction: next,
          }),
        })
      )
      .then((res) => {
        if (!res.ok) throw new Error(`reaction failed: ${res.status}`);
        committedRef.current.set(songId, next);
        pendingRefreshRef.current = true;
      })
      .catch(() => {
        if (reactionsRef.current.get(songId) === next) {
          const committed = committedRef.current.get(songId) ?? null;
          reactionsRef.current.set(songId, committed);
          setReactions(new Map(reactionsRef.current));
        }
      });
    writeChainRef.current.set(songId, write);
  };

  if (!current) return null;
  const next = stableQueue[curIndex + 1];
  const currentReaction = reactions.get(current.id) ?? null;

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
          {/* Reaction overlay must live inside FullscreenPlayer —
              in native fullscreen only descendants of the fullscreen
              element render (same technique as the watch page). */}
          {profileId && (
            <div className="absolute top-3 right-3 z-50 flex gap-3">
              <button
                onClick={() => react("like")}
                aria-label="Like song"
                aria-pressed={currentReaction === "like"}
                className={cn(
                  "flex h-12 w-12 items-center justify-center",
                  "rounded-full bg-black/60 transition-colors",
                  "hover:bg-black/80"
                )}
              >
                <ThumbsUp
                  size={24}
                  weight={
                    currentReaction === "like" ? "fill" : "regular"
                  }
                  className={
                    currentReaction === "like"
                      ? "text-primary"
                      : "text-white"
                  }
                />
              </button>
              <button
                onClick={() => react("dislike")}
                aria-label="Dislike song"
                aria-pressed={currentReaction === "dislike"}
                className={cn(
                  "flex h-12 w-12 items-center justify-center",
                  "rounded-full bg-black/60 transition-colors",
                  "hover:bg-black/80"
                )}
              >
                <ThumbsDown
                  size={24}
                  weight={
                    currentReaction === "dislike" ? "fill" : "regular"
                  }
                  className={
                    currentReaction === "dislike"
                      ? "text-red-500"
                      : "text-white"
                  }
                />
              </button>
            </div>
          )}
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
