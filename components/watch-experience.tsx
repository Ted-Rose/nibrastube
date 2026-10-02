"use client";

import { useEffect, useRef, useState, type TouchEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, House } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { FullscreenPlayer } from "@/components/fullscreen-player";
import { SwipeConfirmDialog } from "@/components/swipe-confirm-dialog";
import { pickNextIndex } from "@/lib/autoplay";
import { classifySwipe } from "@/lib/gestures";
import type { SwipeDirection } from "@/lib/gestures";
import { cn } from "@/lib/utils";
import type { WatchStatus } from "@/lib/kids-feed";

interface YTPlayerEvent {
  data: number;
}

interface YTPlayer {
  destroy(): void;
  loadVideoById(videoId: string): void;
  loadVideoById(args: { videoId: string; startSeconds?: number }): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoData(): { video_id?: string } | undefined;
  pauseVideo(): void;
  playVideo(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width: string;
      height: string;
      playerVars?: Record<string, number>;
      events?: { onStateChange?: (event: YTPlayerEvent) => void };
    }
  ) => YTPlayer;
  PlayerState: {
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface PlaylistVideo {
  id: string;
  title: string;
  startSeconds?: number;
  status: WatchStatus;
}

interface WatchExperienceProps {
  profileId: string;
  profileName: string;
  profileAvatar: string | null;
  playlist: PlaylistVideo[];
  startIndex: number;
  // Query string (incl. leading "?", or "") preserving the grid context —
  // view/channel/sort/q — the kid arrived from.
  returnQuery?: string;
  // Per-profile opt-in: swipe right/up = next video, left/down = previous.
  swipeEnabled: boolean;
}

export function WatchExperience({
  profileId,
  profileName,
  profileAvatar,
  playlist,
  startIndex,
  returnQuery = "",
  swipeEnabled,
}: WatchExperienceProps) {
  const router = useRouter();
  const portalUrl = `/kids/${profileId}${returnQuery}`;
  const [index, setIndex] = useState(startIndex);
  const indexRef = useRef(startIndex);
  const containerRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const advancingRef = useRef(false);
  // Latest position sample, kept fresh by the 500ms tick below.
  const latestRef = useRef({ videoId: "", position: 0, duration: 0 });
  const lastSentRef = useRef(0);
  const lastSentPositionRef = useRef(0);
  // Per-video watch status keyed by id, updated in-session by advance() —
  // the playlist prop is a page-load snapshot, but kids watch many videos
  // without re-navigating.
  const statusRef = useRef(new Map<string, WatchStatus>());
  // Videos finished during this session — their startSeconds prop is a
  // stale page-load resume point, so replays must start at 0.
  const completedRef = useRef(new Set<string>());
  // Swipe-"back" history: every navigation pushes the outgoing index, so
  // prev = the video the kid just came from (not blindly index−1) and
  // autoplay-advanced videos are back-reachable too.
  const navStackRef = useRef<number[]>([]);
  // The nav functions live inside the effect (they need its flush/playlist
  // closures); this ref surfaces them to the JSX touch handlers.
  const swipeNavRef = useRef<{ next: () => void; prev: () => void } | null>(
    null
  );
  const [pendingSwipe, setPendingSwipe] = useState<{
    dir: SwipeDirection;
    title?: string;
  } | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;

    // Status can only rise in-session (watched stays watched), so merge
    // rather than replace — a refresh landing between a video finishing
    // and its flush POST must not downgrade it back to "started".
    for (const v of playlist) {
      statusRef.current.set(
        v.id,
        Math.max(v.status, statusRef.current.get(v.id) ?? 0) as WatchStatus
      );
    }

    // A Pusher refresh can shrink or reorder the playlist mid-session —
    // follow the still-playing video by id, else clamp the index in
    // bounds. Without this the recreated player would load whichever
    // video now happens to sit at the stale index.
    const playingIdx = playlist.findIndex(
      (v) => v.id === latestRef.current.videoId
    );
    if (playingIdx !== -1) {
      indexRef.current = playingIdx;
    } else if (indexRef.current >= playlist.length) {
      indexRef.current = Math.max(0, playlist.length - 1);
    }
    setIndex(indexRef.current);

    // Playlist changed under an open swipe dialog — the pending target
    // preview may be stale, so drop it. The recreated player autoplays,
    // which is the "keep watching" outcome anyway.
    setPendingSwipe(null);

    // Playlist emptied mid-session — nothing to play; the watch page
    // redirects when the current video is unpinned, so this is a brief
    // transitional state at most.
    if (playlist.length === 0) return;

    // POST the current position to /api/watch-progress. Beacon for unload
    // paths (pagehide/unmount), throttled keepalive fetch otherwise.
    const flush = (useBeacon = false) => {
      const { videoId, position, duration } = latestRef.current;
      if (!videoId || duration <= 0) return;
      lastSentRef.current = Date.now();
      lastSentPositionRef.current = position;
      const payload = JSON.stringify({
        profileId,
        videoId,
        positionSeconds: Math.floor(position),
        durationSeconds: Math.floor(duration),
        completed: position >= duration * 0.95,
        sentAt: Date.now(),
      });
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/watch-progress",
          new Blob([payload], { type: "application/json" })
        );
      } else {
        fetch("/api/watch-progress", {
          method: "POST",
          body: payload,
          keepalive: true,
          headers: { "Content-Type": "application/json" },
        }).catch(() => {});
      }
    };

    // Switch to another playlist index by loading it into the SAME player
    // instead of navigating — keeps the element (and fullscreen mode)
    // mounted. Shared by autoplay and swipe gestures.
    const goTo = (next: number) => {
      // Flush BEFORE loadVideoById — the player is reused, so the old
      // video's position would otherwise be lost.
      flush();
      // Record the outgoing video's status from the latest sample so a
      // video finished this session moves to tier 2 and isn't re-picked
      // ahead of unwatched/started videos.
      const { videoId, position, duration } = latestRef.current;
      const cur = indexRef.current;
      const curId = playlist[cur]?.id;
      if (curId && videoId === curId) {
        const status: WatchStatus =
          duration > 0 && position >= duration * 0.95
            ? 2
            : position > 0
              ? 1
              : 0;
        statusRef.current.set(
          curId,
          Math.max(statusRef.current.get(curId) ?? 0, status) as WatchStatus
        );
        if (status === 2) completedRef.current.add(curId);
      }
      if (next !== cur) navStackRef.current.push(cur);
      indexRef.current = next;
      setIndex(next);
      playerRef.current?.loadVideoById({
        videoId: playlist[next].id,
        startSeconds: completedRef.current.has(playlist[next].id)
          ? 0
          : (playlist[next].startSeconds ?? 0),
      });
      window.history.replaceState(
        null,
        "",
        `/kids/${profileId}/watch/${playlist[next].id}${returnQuery}`
      );
    };

    const advance = () => {
      if (advancingRef.current) return;
      advancingRef.current = true;
      goTo(
        pickNextIndex(
          playlist.length,
          indexRef.current,
          (i) => statusRef.current.get(playlist[i].id) ?? 0
        )
      );
    };

    // Previous = the video the kid just came from (nav history stack),
    // falling back to index−1 when the stack is empty.
    const goBack = () => {
      if (advancingRef.current) return;
      advancingRef.current = true;
      // Pop until a still-valid index — a mid-session playlist shrink can
      // leave entries out of bounds, and self-entries are useless.
      let prev = navStackRef.current.pop();
      while (
        prev !== undefined &&
        (prev >= playlist.length || prev === indexRef.current)
      ) {
        prev = navStackRef.current.pop();
      }
      goTo(
        prev ?? (indexRef.current - 1 + playlist.length) % playlist.length
      );
    };

    swipeNavRef.current = { next: advance, prev: goBack };

    const createPlayer = () => {
      const container = containerRef.current;
      if (cancelled || !container || !window.YT?.Player) return;

      // The YT API replaces the mount node with its iframe, so if a
      // previous player consumed it (e.g. StrictMode remount), create
      // a fresh mount point.
      if (!mountRef.current || !mountRef.current.isConnected) {
        const el = document.createElement("div");
        el.className = "w-full h-full";
        container.appendChild(el);
        mountRef.current = el;
      }

      const currentVideo = playlist[indexRef.current];
      playerRef.current = new window.YT.Player(mountRef.current, {
        videoId: currentVideo.id,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 1,
          modestbranding: 1,
          rel: 0,
          iv_load_policy: 3,
          controls: 1,
          playsinline: 1,
          // When the player is recreated by a mid-session playlist
          // refresh, resume the live position — not the stale page-load
          // startSeconds snapshot.
          start: Math.floor(
            latestRef.current.videoId === currentVideo.id
              ? latestRef.current.position
              : (currentVideo.startSeconds ?? 0)
          ),
        },
        events: {
          onStateChange: (event) => {
            if (event.data === window.YT?.PlayerState.PLAYING) {
              advancingRef.current = false;
            }
            if (event.data === window.YT?.PlayerState.PAUSED) flush();
            if (event.data === window.YT?.PlayerState.ENDED) {
              // Position = duration so advance()'s flush marks it completed.
              latestRef.current = {
                ...latestRef.current,
                position: latestRef.current.duration,
              };
              advance();
            }
          },
        },
      });
    };

    if (window.YT?.Player) {
      createPlayer();
    } else {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        createPlayer();
      };
      if (
        !document.querySelector(
          'script[src="https://www.youtube.com/iframe_api"]'
        )
      ) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(tag);
      }
    }

    // Embedded Shorts loop internally and never emit ENDED, so also
    // poll playback position: advance when the video is nearly over or
    // when the playhead wraps back to the start after a loop (a 500ms
    // poll can straddle the 0.4s end-of-video window and miss it).
    // Tapping a "More videos" suggestion loads a different video inside
    // the same embed — never navigates away — so Screen Time can't help.
    // Enforce the whitelist ourselves: snap back to approved content.
    const approvedIds = new Set(playlist.map((v) => v.id));

    let lastTime = 0;
    let lastLoadedId: string | undefined;
    const tick = window.setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      const loadedId = p.getVideoData()?.video_id;
      const currentId = playlist[indexRef.current].id;
      if (loadedId !== lastLoadedId) {
        // A different video is cueing — playhead history from the
        // previous video must not feed the wrap check below.
        lastLoadedId = loadedId;
        lastTime = 0;
      }
      if (loadedId && !approvedIds.has(loadedId)) {
        // Rogue video — flush the approved video's last position first,
        // then snap back to where it left off.
        flush();
        const resume = latestRef.current;
        const startSeconds =
          resume.videoId === currentId &&
          resume.duration > 0 &&
          resume.position < resume.duration - 10
            ? resume.position
            : 0;
        p.loadVideoById({ videoId: currentId, startSeconds });
        return;
      }
      const duration = p.getDuration();
      const time = p.getCurrentTime();
      // Only act when the loaded video is the expected playlist entry —
      // a rogue "More videos" embed must not overwrite its position or
      // feed the end-of-video checks.
      const isExpected = loadedId === currentId;
      if (isExpected) {
        latestRef.current = { videoId: currentId, position: time, duration };
      }
      const wrapped =
        duration > 0 && lastTime >= duration - 1 && time < 1;
      lastTime = time;
      if (
        !isExpected ||
        p.getPlayerState() !== window.YT?.PlayerState.PLAYING
      ) {
        return;
      }
      // Periodic flush covers swipe-kill / crash where no lifecycle
      // event fires (common on mobile PWA).
      if (
        Date.now() - lastSentRef.current > 10_000 &&
        Math.abs(time - lastSentPositionRef.current) > 2
      ) {
        flush();
      }
      if (duration > 0 && (time >= duration - 0.4 || wrapped)) {
        advance();
      }
    }, 500);

    // pagehide is the reliable unload event on mobile; beforeunload is not.
    const flushBeacon = () => flush(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    window.addEventListener("pagehide", flushBeacon);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(tick);
      window.removeEventListener("pagehide", flushBeacon);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      // Unmount (Back to Videos / House / route change) — last chance flush.
      flush(true);
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [profileId, playlist, router, portalUrl, returnQuery]);

  // The index goBack would pick, for the confirm dialog's title preview.
  const peekPrevIndex = () => {
    for (let i = navStackRef.current.length - 1; i >= 0; i--) {
      const idx = navStackRef.current[i];
      if (idx < playlist.length && idx !== indexRef.current) return idx;
    }
    return (indexRef.current - 1 + playlist.length) % playlist.length;
  };

  // Per-device opt-out from the confirm dialog (kid's own preference,
  // same localStorage precedent as daily-sync-ping).
  const noConfirmKey = `nibrastube:swipe-no-confirm:${profileId}`;

  const handleSwipe = (dir: SwipeDirection) => {
    if (!swipeEnabled || pendingSwipe || playlist.length <= 1) return;
    if (advancingRef.current) return;
    if (localStorage.getItem(noConfirmKey) === "1") {
      if (dir === "next") swipeNavRef.current?.next();
      else swipeNavRef.current?.prev();
      return;
    }
    // Resolve the target now (event handler — refs are readable here) so
    // the dialog can show which video the swipe would switch to.
    const target =
      dir === "next"
        ? pickNextIndex(
            playlist.length,
            indexRef.current,
            (i) => statusRef.current.get(playlist[i].id) ?? 0
          )
        : peekPrevIndex();
    // Pause under the modal so audio doesn't keep playing.
    playerRef.current?.pauseVideo();
    setPendingSwipe({ dir, title: playlist[target]?.title });
  };

  const confirmSwipe = (dontAskAgain: boolean) => {
    const dir = pendingSwipe?.dir;
    setPendingSwipe(null);
    if (!dir) return;
    if (dontAskAgain) localStorage.setItem(noConfirmKey, "1");
    if (dir === "next") swipeNavRef.current?.next();
    else swipeNavRef.current?.prev();
  };

  const cancelSwipe = () => {
    setPendingSwipe(null);
    playerRef.current?.playVideo();
  };

  // Single-touch tracking shared by every swipe zone — a second finger
  // joining cancels the gesture. Note: touches starting inside the
  // cross-origin YouTube iframe never reach us, which is why the edge
  // strips over the player exist below.
  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      touchStartRef.current = null;
      return;
    }
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length !== 1) touchStartRef.current = null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || pendingSwipe) return;
    const t = e.changedTouches[0];
    const dir = classifySwipe(
      t.clientX - start.x,
      t.clientY - start.y,
      Date.now() - start.t
    );
    if (dir) handleSwipe(dir);
  };
  const onTouchCancel = () => {
    touchStartRef.current = null;
  };

  // Clamp at render too: a Pusher refresh can shrink the playlist while
  // `index` still points past the new end (the effect clamp runs only
  // after this render).
  const current = playlist[Math.min(index, playlist.length - 1)];
  if (!current) return null;

  return (
    // touch-none when swipe is on so scroll/pull-to-refresh doesn't steal
    // the gesture — the watch page is built to fit the viewport.
    <div
      className={cn(
        "min-h-screen bg-black flex flex-col",
        swipeEnabled && "touch-none select-none"
      )}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
    >
      {/* Player Header */}
      <div className="bg-slate-900/80 backdrop-blur px-3 sm:px-6 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-[max(1rem,env(safe-area-inset-top))] pb-3 sm:pb-4 flex items-center justify-between gap-2 text-white border-b border-slate-800">
        <Link href={portalUrl} aria-label="Back to videos">
          <Button
            variant="ghost"
            className="text-white hover:bg-slate-800 gap-2 h-11 sm:h-9 px-3"
          >
            <ArrowLeft size={24} weight="bold" />
            <span className="hidden sm:inline text-lg font-bold">Back to Videos</span>
          </Button>
        </Link>

        <div className="flex-1 min-w-0 text-center px-2">
          <h1 className="text-base sm:text-xl font-bold truncate max-w-full">
            {current.title}
          </h1>
        </div>

        <Link href="/kids" aria-label="Switch profile">
          <div className="w-11 h-11 sm:w-12 sm:h-12 bg-white/10 rounded-2xl flex items-center justify-center hover:bg-white/20 transition-colors">
            <House size={24} weight="bold" />
          </div>
        </Link>
      </div>

      {/* Video Player Area */}
      <div className="flex-1 flex items-center justify-center p-4 md:p-10">
        <FullscreenPlayer>
          <div ref={containerRef} className="w-full h-full">
            <div ref={mountRef} className="w-full h-full" />
          </div>
          {swipeEnabled && (
            <>
              {/* Edge swipe zones: touches starting inside the cross-origin
                  YT iframe never reach our document, so these transparent
                  strips catch swipes that begin at the screen edge. They
                  must live INSIDE FullscreenPlayer — in native fullscreen
                  only descendants of fullscreenElement render. bottom-16
                  leaves the YouTube control bar (incl. corner buttons)
                  reachable; the video center stays fully tappable. */}
              <div
                className="absolute top-0 bottom-16 left-0 w-7 z-40 touch-none"
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
                onTouchCancel={onTouchCancel}
              />
              <div
                className="absolute top-0 bottom-16 right-0 w-7 z-40 touch-none"
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
                onTouchCancel={onTouchCancel}
              />
            </>
          )}
          {pendingSwipe && (
            <SwipeConfirmDialog
              direction={pendingSwipe.dir}
              targetTitle={pendingSwipe.title}
              onConfirm={confirmSwipe}
              onCancel={cancelSwipe}
            />
          )}
        </FullscreenPlayer>
      </div>

      {/* Kid-Friendly Controls (Optional/Simplified) */}
      <div className="bg-slate-900/50 p-4 sm:p-8 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-[max(2rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-4">
        <div className="flex items-center gap-4 sm:gap-10">
          <Link
            href="/kids"
            aria-label="Switch profile"
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-white rounded-3xl flex items-center justify-center text-3xl sm:text-4xl shadow-lg border-4 border-primary">
              {profileAvatar}
            </div>
            <div className="text-white">
              <p className="text-xs sm:text-sm text-slate-400 font-bold uppercase tracking-widest">
                Watching as
              </p>
              <p className="text-xl sm:text-2xl font-black">{profileName}</p>
            </div>
          </Link>

          <div className="h-10 w-[2px] bg-slate-800 hidden md:block"></div>

          <p className="text-slate-400 text-lg font-medium hidden md:block">
            Approved by Mom & Dad
          </p>
        </div>
      </div>
    </div>
  );
}
