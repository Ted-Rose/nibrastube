// Shared YouTube IFrame-API types and loader for the in-app players
// (watch-experience, song-player-overlay). The global Window.YT
// declaration must live here exactly once — two local declarations of
// different shapes collide as TS2717.

export interface YTPlayerEvent {
  data: number;
}

export interface YTPlayer {
  destroy(): void;
  loadVideoById(videoId: string): void;
  loadVideoById(args: {
    videoId: string;
    startSeconds?: number;
    endSeconds?: number;
  }): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoData(): { video_id?: string } | undefined;
  getVideoUrl(): string;
  pauseVideo(): void;
  playVideo(): void;
}

export interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width: string;
      height: string;
      playerVars?: Record<string, number>;
      events?: {
        onReady?: (event: { target: YTPlayer }) => void;
        onStateChange?: (event: YTPlayerEvent) => void;
        onError?: (event: YTPlayerEvent) => void;
      };
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

// Classes for the div new YT.Player() mounts onto — the API replaces
// that node with its iframe and transfers the class list to it.
// Shared by the JSX mount node AND the detached-node recreation paths
// in both players so they can't drift: rounded-3xl rounds the iframe's
// own corners (no clipping ancestor allowed — see the invariant in
// fullscreen-player.tsx), fullscreen: squares them when the iframe
// itself takes fullscreen via the embed's ⛶ button.
export const YT_MOUNT_CLASS =
  "w-full h-full rounded-3xl fullscreen:rounded-none";

// getVideoData() is undocumented — it is absent on some widget builds
// and before the player is ready, so fall back to the documented
// getVideoUrl() and parse its v= param.
export function loadedVideoId(p: YTPlayer): string | undefined {
  if (typeof p.getVideoData === "function") {
    return p.getVideoData()?.video_id;
  }
  if (typeof p.getVideoUrl === "function") {
    return /[?&]v=([^&]+)/.exec(p.getVideoUrl())?.[1];
  }
  return undefined;
}

// Injects the IFrame-API script once and calls onReady once
// window.YT.Player is usable. Safe to call from several components —
// each chains onto the previous global callback so every caller's
// onReady fires even though only the last assignment wins.
export function ensureYouTubeAPI(onReady: () => void): void {
  if (window.YT?.Player) {
    onReady();
    return;
  }
  const prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    prev?.();
    onReady();
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
