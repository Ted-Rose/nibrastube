import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  ensureYouTubeAPI,
  YT_MOUNT_CLASS,
  type YTPlayer,
  type YTPlayerEvent,
} from "@/lib/yt-player";

// Shared hooks for the three IFrame-embed surfaces
// (watch-experience, song-player-overlay, video-preview-overlay) —
// each used to re-implement the same lifecycle by hand.

// What the player should load. `key` is the queue row's own identity
// — NOT the YouTube id: two queue entries can share a videoId at
// different segments, so the onReady catch-up compares keys to tell
// "target moved during init" apart from "same load".
export interface PlayerLoad {
  key: string;
  videoId: string;
  startSeconds?: number;
  endSeconds?: number;
}

export interface PlayerEvents {
  onReady?: (event: { target: YTPlayer }) => void;
  onStateChange?: (event: YTPlayerEvent) => void;
  onError?: (event: YTPlayerEvent) => void;
}

// iframe_api failing to load (offline, CSP, blocked domain) used to
// leave a permanent black box — surface it after a timeout instead.
const API_LOAD_TIMEOUT_MS = 10_000;

// Owns the player lifecycle all three embeds share: ensureYouTubeAPI
// → createPlayer (mount-node recreation guard) → createdPlayer held
// private until onReady publishes playerRef → onReady catch-up
// loadVideoById when the target moved during init → cleanup destroy()
// covering a never-ready player. The callback identities ARE the
// recreate signal — callers must memoize events/getInitialLoad/
// getCatchUpLoad on the inputs that should rebuild the player.
// Consumers must OVERLAY the loadFailed notice on the still-mounted
// containerRef div — swapping it out nulls the ref, createPlayer
// early-returns, and a late API arrival can never reach the onReady
// self-clear below (the error becomes terminal until remount).
export function useYouTubePlayer({
  containerRef,
  mountRef,
  playerVars,
  events,
  getInitialLoad,
  getCatchUpLoad,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  mountRef: RefObject<HTMLDivElement | null>;
  // Extra playerVars merged over the shared set.
  playerVars?: Record<string, number>;
  events: PlayerEvents;
  // Load the player starts with; null = nothing to play.
  getInitialLoad: () => PlayerLoad | null;
  // Called in onReady with the initial load — returns the load to
  // catch up to when the target moved during init, or null.
  getCatchUpLoad: (initial: PlayerLoad) => PlayerLoad | null;
}) {
  const playerRef = useRef<YTPlayer | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // The constructed player is kept here (not in playerRef) until its
    // onReady fires — the API methods only exist then, and publishing
    // the ref early let callers invoke them on a not-yet-ready player
    // ("getVideoData is not a function").
    let createdPlayer: YTPlayer | null = null;
    let apiReady = false;

    const createPlayer = () => {
      apiReady = true;
      const container = containerRef.current;
      if (cancelled || !container || !window.YT?.Player) return;

      // The YT API replaces the mount node with its iframe, so if a
      // previous player consumed it (e.g. StrictMode remount), create
      // a fresh mount point.
      if (!mountRef.current || !mountRef.current.isConnected) {
        const el = document.createElement("div");
        el.className = YT_MOUNT_CLASS;
        container.appendChild(el);
        mountRef.current = el;
      }

      const load = getInitialLoad();
      if (!load) return;
      createdPlayer = new window.YT.Player(mountRef.current, {
        videoId: load.videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 1,
          modestbranding: 1,
          rel: 0,
          iv_load_policy: 3,
          controls: 1,
          playsinline: 1,
          ...(load.startSeconds !== undefined
            ? { start: Math.floor(load.startSeconds) }
            : {}),
          ...(load.endSeconds !== undefined
            ? { end: load.endSeconds }
            : {}),
          ...playerVars,
        },
        events: {
          onReady: (event) => {
            // Cleanup ran before the player finished initializing —
            // it was already destroyed, so don't publish the ref.
            if (cancelled || !createdPlayer) return;
            playerRef.current = createdPlayer;
            // A ready player supersedes any load-timeout error —
            // reachable only because consumers keep containerRef
            // mounted under the notice.
            setLoadFailed(false);
            // A nav during init skipped its loadVideoById (the ref
            // was still null) — catch up if the target moved.
            const catchUp = getCatchUpLoad(load);
            if (catchUp) {
              createdPlayer.loadVideoById({
                videoId: catchUp.videoId,
                startSeconds: catchUp.startSeconds,
                endSeconds: catchUp.endSeconds,
              });
            }
            events.onReady?.(event);
          },
          // Events from an already-destroyed player can still arrive
          // (a queued postMessage landing after cleanup, a StrictMode
          // straggler) — drop them so they can't set state or fire a
          // phantom advance against the new effect's closures.
          onStateChange: (event) => {
            if (cancelled) return;
            events.onStateChange?.(event);
          },
          onError: (event) => {
            if (cancelled) return;
            events.onError?.(event);
          },
        },
      });
    };

    ensureYouTubeAPI(createPlayer);
    // No failure path inside ensureYouTubeAPI — if the script never
    // arrives, surface an error state rather than a dead player area.
    const loadTimeout = window.setTimeout(() => {
      if (!cancelled && !apiReady) setLoadFailed(true);
    }, API_LOAD_TIMEOUT_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(loadTimeout);
      // createdPlayer also covers a player that never reached onReady
      // (playerRef stays null in that case) — and its destroy() may
      // not exist yet either, and can throw when it does.
      try {
        createdPlayer?.destroy?.();
      } catch {
        // The API throws if destroy() races a not-yet-ready player.
      }
      createdPlayer = null;
      playerRef.current = null;
      mountRef.current = null;
    };
  }, [
    containerRef,
    mountRef,
    playerVars,
    events,
    getInitialLoad,
    getCatchUpLoad,
  ]);

  return { playerRef, loadFailed };
}

// The watch page's position reporting: POST the latest sample to
// /api/watch-progress — beacon for unload paths (pagehide/unmount),
// throttled keepalive fetch otherwise — plus the lastSent markers the
// 500ms tick throttles against.
export function useProgressFlush(
  profileId: string,
  latestRef: RefObject<{
    videoId: string;
    position: number;
    duration: number;
  }>
) {
  const lastSentRef = useRef(0);
  const lastSentPositionRef = useRef(0);

  const flush = useCallback(
    (useBeacon = false) => {
      const { videoId, position, duration } = latestRef.current;
      if (!videoId || duration <= 0) return;
      lastSentRef.current = Date.now();
      lastSentPositionRef.current = position;
      const now = new Date();
      const payload = JSON.stringify({
        profileId,
        videoId,
        positionSeconds: Math.floor(position),
        durationSeconds: Math.floor(duration),
        completed: position >= duration * 0.95,
        sentAt: Date.now(),
        // YYYY-MM-DD from the date parts — toLocaleDateString("en-CA")
        // relied on ICU returning ISO and silently 400'd the flush
        // where it didn't.
        day: `${now.getFullYear()}-${String(
          now.getMonth() + 1
        ).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
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
    },
    [profileId, latestRef]
  );

  useEffect(() => {
    // pagehide is the reliable unload event on mobile; beforeunload
    // is not.
    const flushBeacon = () => flush(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    window.addEventListener("pagehide", flushBeacon);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushBeacon);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      // Unmount (Back to Videos / House / route change) — last chance
      // flush.
      flush(true);
    };
  }, [flush]);

  return { flush, lastSentRef, lastSentPositionRef };
}

// Swipe-"back" history: every navigation pushes the outgoing video id
// (an index would retarget on a mid-session reorder), so prev = the
// video the kid just came from (not blindly index−1) and
// autoplay-advanced videos are back-reachable too. findIndexById
// resolves a stacked id to a landable index or -1, so the stack stays
// playlist-shape-agnostic.
export function useNavStack(findIndexById: (id: string) => number) {
  const navStackRef = useRef<string[]>([]);

  const pushNavId = useCallback((id: string) => {
    navStackRef.current.push(id);
  }, []);

  // Pop until a stacked id still resolves — a mid-session unpin
  // leaves dangling entries. -1 = nothing landable on the stack.
  const popPrevIndex = useCallback(() => {
    let id = navStackRef.current.pop();
    while (id !== undefined) {
      const idx = findIndexById(id);
      if (idx !== -1) return idx;
      id = navStackRef.current.pop();
    }
    return -1;
  }, [findIndexById]);

  // The index goBack would pick, for the confirm dialog's title
  // preview — same resolution as popPrevIndex without popping.
  const peekPrevIndex = useCallback(() => {
    for (let i = navStackRef.current.length - 1; i >= 0; i--) {
      const idx = findIndexById(navStackRef.current[i]);
      if (idx !== -1) return idx;
    }
    return -1;
  }, [findIndexById]);

  return { pushNavId, popPrevIndex, peekPrevIndex };
}
