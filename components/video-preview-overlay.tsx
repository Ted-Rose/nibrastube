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
  PushPin,
  X,
} from "@phosphor-icons/react";
import { pinVideo } from "@/app/actions/pinning";
import { FullscreenPlayer } from "@/components/fullscreen-player";
import {
  useYouTubePlayer,
  type PlayerEvents,
  type PlayerLoad,
} from "@/components/player-hooks";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DashboardVideo } from "@/lib/youtube";

// In-app ?video= preview for the parent dashboard — watch-page chrome
// (back link + title + X, FullscreenPlayer) around a single IFrame
// embed so a parent can vet a video before pinning. Escape or the
// header links navigate back to `closeHref`.
//
// The kids players' rogue-suggested-video snapback is deliberately NOT
// here: that guard protects kid-reachable surfaces, and a "More
// videos" hijack inside a parent-only preview is harmless (even
// informative — it shows what YouTube would offer alongside). Don't
// "fix" this by porting the 500ms poll.
export function VideoPreviewOverlay({
  video,
  pinned,
  profileId,
  profileName,
  closeHref,
}: {
  video: DashboardVideo;
  pinned: boolean;
  profileId: string;
  profileName: string;
  // The dashboard URL without &video= — closing is a deterministic
  // navigation, not history.back(), so a shared link can't strand the
  // visitor on a site exit.
  closeHref: string;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  // An embed failure swaps the player area for a notice — a
  // parent-only surface has no queue to advance.
  const [errored, setErrored] = useState(false);

  const events = useMemo<PlayerEvents>(
    () => ({
      onError: () => setErrored(true),
    }),
    []
  );
  const getInitialLoad = useCallback(
    (): PlayerLoad => ({ key: video.id, videoId: video.id }),
    [video.id]
  );
  // Single-video surface — nothing to catch up to.
  const getCatchUpLoad = useCallback(() => null, []);
  const { loadFailed } = useYouTubePlayer({
    containerRef,
    mountRef,
    events,
    getInitialLoad,
    getCatchUpLoad,
  });

  useEffect(() => {
    const close = () => router.push(closeHref, { scroll: false });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    // Keep the dashboard from scrolling behind the player.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [closeHref, router]);

  const duration = formatDuration(video.durationSeconds);
  const views =
    video.viewCount != null
      ? `${Intl.NumberFormat("en", { notation: "compact" }).format(
          video.viewCount
        )} views`
      : null;

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
          aria-label="Back to dashboard"
        >
          <Button
            variant="ghost"
            className={cn(
              "h-11 gap-2 px-3 text-white hover:bg-slate-800 sm:h-9"
            )}
          >
            <ArrowLeft size={24} weight="bold" />
            <span className="hidden text-lg font-bold sm:inline">
              Back to Dashboard
            </span>
          </Button>
        </Link>

        <div className="min-w-0 flex-1 px-2 text-center">
          <h1 className="max-w-full truncate text-base font-bold sm:text-xl">
            {video.title}
          </h1>
        </div>

        <Link
          href={closeHref}
          scroll={false}
          aria-label="Close preview"
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
          auto-fullscreen behavior as the watch page; portrait keeps
          Shorts letterboxed. An embed failure (or an iframe_api load
          timeout) swaps the player for a notice — there is no queue
          to advance. */}
      <div className="flex flex-1 items-center justify-center p-4 md:p-10">
        {errored || loadFailed ? (
          <div
            className={cn(
              "flex aspect-video w-full max-w-6xl flex-col",
              "items-center justify-center gap-3 rounded-[32px]",
              "border-4 border-slate-800 bg-slate-900 px-6",
              "text-center shadow-2xl"
            )}
          >
            <p className="text-xl font-black text-white sm:text-2xl">
              {loadFailed && !errored
                ? "Can\u2019t reach YouTube"
                : "This video can\u2019t be played in the embed"}
            </p>
            <p
              className={cn(
                "max-w-md text-sm font-medium text-slate-400",
                "sm:text-base"
              )}
            >
              {loadFailed && !errored
                ? "Check the connection, then close and reopen."
                : "The owner may have disabled embedding — " +
                  "open it on YouTube instead."}
            </p>
          </div>
        ) : (
          <FullscreenPlayer portrait={video.isShort}>
            <div ref={containerRef} className="h-full w-full">
              <div ref={mountRef} className="h-full w-full" />
            </div>
          </FullscreenPlayer>
        )}
      </div>

      {/* Bottom bar — vetting metadata + the pin action. Pinning does
          NOT close the overlay: revalidation flips the button to
          Approved and the parent keeps vetting. */}
      <div
        className={cn(
          "flex flex-col items-center gap-4 bg-slate-900/50 p-4",
          "pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-8",
          "sm:pb-[max(2rem,env(safe-area-inset-bottom))]"
        )}
      >
        <div
          className={cn(
            "flex flex-wrap items-center justify-center",
            "gap-x-8 gap-y-3 text-white"
          )}
        >
          <div className="min-w-0">
            <p
              className={cn(
                "text-xs font-bold uppercase tracking-widest",
                "text-slate-400"
              )}
            >
              Previewing
            </p>
            <p
              className={cn(
                "max-w-[60vw] truncate text-xl font-black",
                "sm:text-2xl"
              )}
            >
              {video.channelTitle}
            </p>
          </div>

          <p className="text-sm font-medium text-slate-400">
            {[
              duration,
              views,
              video.publishedAt?.toLocaleDateString(),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>

          {pinned ? (
            <Button
              disabled
              className="bg-green-100 text-green-700 hover:bg-green-100"
            >
              <PushPin size={18} className="mr-2" /> Approved
            </Button>
          ) : (
            <form
              action={pinVideo.bind(null, profileId, video.id)}
            >
              <SubmitButton
                size="touch"
                pendingLabel="Pinning…"
                className="hover:bg-primary/90"
              >
                Pin to {profileName}
              </SubmitButton>
            </form>
          )}

          <a
            href={`https://youtube.com/watch?v=${video.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "text-sm font-medium text-slate-400 underline-offset-4",
              "hover:text-white hover:underline"
            )}
          >
            Open on YouTube
          </a>
        </div>
      </div>
    </div>
  );
}
