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
