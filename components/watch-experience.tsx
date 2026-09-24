"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, House } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { FullscreenPlayer } from "@/components/fullscreen-player";
import { pickNextIndex } from "@/lib/autoplay";
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
}

export function WatchExperience({
  profileId,
  profileName,
  profileAvatar,
  playlist,
  startIndex,
  returnQuery = "",
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
  // Per-index watch status, updated in-session by advance() — the playlist
  // prop is a page-load snapshot, but kids watch many videos without
  // re-navigating.
  const statusRef = useRef<WatchStatus[]>([]);

  useEffect(() => {
    let cancelled = false;

    statusRef.current = playlist.map((v) => v.status);
    // A Pusher refresh can shrink the playlist mid-session — keep the
    // current index in bounds.
    if (indexRef.current >= playlist.length) {
      indexRef.current = Math.max(0, playlist.length - 1);
      setIndex(indexRef.current);
    }

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

    // Advance by loading the next video into the SAME player instead of
    // navigating — keeps the element (and fullscreen mode) mounted.
    const advance = () => {
      if (advancingRef.current) return;
      advancingRef.current = true;
      // Flush BEFORE loadVideoById — the player is reused, so the old
      // video's position would otherwise be lost.
      flush();
      // Record the outgoing video's status from the latest sample so a
      // video finished this session isn't re-picked as tier 1/2.
      const { videoId, position, duration } = latestRef.current;
      const cur = indexRef.current;
      if (videoId === playlist[cur].id) {
        const status: WatchStatus =
          duration > 0 && position >= duration * 0.95
            ? 2
            : position > 0
              ? 1
              : 0;
        statusRef.current[cur] = Math.max(
          statusRef.current[cur],
          status
        ) as WatchStatus;
      }
      const next = pickNextIndex(
        playlist.length,
        cur,
        (i) => statusRef.current[i]
      );
      indexRef.current = next;
      setIndex(next);
      playerRef.current?.loadVideoById({
        videoId: playlist[next].id,
        startSeconds: playlist[next].startSeconds ?? 0,
      });
      window.history.replaceState(
        null,
        "",
        `/kids/${profileId}/watch/${playlist[next].id}${returnQuery}`
      );
    };

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

      playerRef.current = new window.YT.Player(mountRef.current, {
        videoId: playlist[indexRef.current].id,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 1,
          modestbranding: 1,
          rel: 0,
          iv_load_policy: 3,
          controls: 1,
          playsinline: 1,
          start: Math.floor(playlist[indexRef.current].startSeconds ?? 0),
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

  const current = playlist[index];

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Player Header */}
      <div className="bg-slate-900/80 backdrop-blur px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
        <Link href={portalUrl}>
          <Button
            variant="ghost"
            className="text-white hover:bg-slate-800 gap-2"
          >
            <ArrowLeft size={24} weight="bold" />
            <span className="text-lg font-bold">Back to Videos</span>
          </Button>
        </Link>

        <div className="flex-1 text-center px-4">
          <h1 className="text-xl font-bold truncate max-w-2xl mx-auto">
            {current.title}
          </h1>
        </div>

        <Link href="/kids">
          <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center hover:bg-white/20 transition-colors">
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
        </FullscreenPlayer>
      </div>

      {/* Kid-Friendly Controls (Optional/Simplified) */}
      <div className="bg-slate-900/50 p-8 flex flex-col items-center gap-4">
        <div className="flex items-center gap-10">
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 bg-white rounded-3xl flex items-center justify-center text-4xl shadow-lg border-4 border-primary">
              {profileAvatar}
            </div>
            <div className="text-white">
              <p className="text-sm text-slate-400 font-bold uppercase tracking-widest">
                Watching as
              </p>
              <p className="text-2xl font-black">{profileName}</p>
            </div>
          </div>

          <div className="h-10 w-[2px] bg-slate-800 hidden md:block"></div>

          <p className="text-slate-400 text-lg font-medium hidden md:block">
            Approved by Mom & Dad
          </p>
        </div>
      </div>
    </div>
  );
}
