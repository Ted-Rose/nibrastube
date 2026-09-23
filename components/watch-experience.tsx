"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, House } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { FullscreenPlayer } from "@/components/fullscreen-player";

interface YTPlayerEvent {
  data: number;
}

interface YTPlayer {
  destroy(): void;
  loadVideoById(videoId: string): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
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
  PlayerState: { ENDED: number; PLAYING: number };
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
}

interface WatchExperienceProps {
  profileId: string;
  profileName: string;
  profileAvatar: string | null;
  playlist: PlaylistVideo[];
  startIndex: number;
}

export function WatchExperience({
  profileId,
  profileName,
  profileAvatar,
  playlist,
  startIndex,
}: WatchExperienceProps) {
  const router = useRouter();
  const [index, setIndex] = useState(startIndex);
  const indexRef = useRef(startIndex);
  const containerRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const advancingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    // Advance by loading the next video into the SAME player instead of
    // navigating — keeps the element (and fullscreen mode) mounted.
    const advance = () => {
      if (advancingRef.current) return;
      advancingRef.current = true;
      const next = indexRef.current + 1;
      if (next < playlist.length) {
        indexRef.current = next;
        setIndex(next);
        playerRef.current?.loadVideoById(playlist[next].id);
        window.history.replaceState(
          null,
          "",
          `/kids/${profileId}/watch/${playlist[next].id}`
        );
      } else {
        router.push(`/kids/${profileId}`);
      }
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
        },
        events: {
          onStateChange: (event) => {
            if (event.data === window.YT?.PlayerState.PLAYING) {
              advancingRef.current = false;
            }
            if (event.data === window.YT?.PlayerState.ENDED) advance();
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
    // poll playback position and advance when the video is nearly over.
    const tick = window.setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      const duration = p.getDuration();
      if (
        duration > 0 &&
        p.getPlayerState() === window.YT?.PlayerState.PLAYING &&
        p.getCurrentTime() >= duration - 0.4
      ) {
        advance();
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearInterval(tick);
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [profileId, playlist, router]);

  const current = playlist[index];

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Player Header */}
      <div className="bg-slate-900/80 backdrop-blur px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
        <Link href={`/kids/${profileId}`}>
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
