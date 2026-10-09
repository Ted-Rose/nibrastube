import Link from "next/link";
import { Heart, Play, ThumbsDown } from "@phosphor-icons/react/dist/ssr";
import { Card, CardContent } from "@/components/ui/card";
import type { watchProgress } from "@/lib/db/schema";
import { formatDuration } from "@/lib/format";
import type { FeedVideo, VideoReaction } from "@/lib/kids-feed";
import { cn } from "@/lib/utils";
import { VideoCardMenu } from "./video-card-menu";

interface VideoCardProps {
  href: string;
  video: FeedVideo;
  profileId: string;
  progress: typeof watchProgress.$inferSelect | null;
  reaction?: VideoReaction | null;
  // Set when the card renders inside a playlist detail view — the ⋮ menu
  // then also offers "Remove from this playlist".
  playlistId?: string;
  // The first above-the-fold cards load eagerly; the rest stay lazy.
  eager?: boolean;
  // "compact" is the denser variant for horizontal shelf rows.
  size?: "default" | "compact";
}

export function VideoCard({
  href,
  video,
  profileId,
  progress,
  reaction,
  playlistId,
  eager = false,
  size = "default",
}: VideoCardProps) {
  const compact = size === "compact";
  const pct = progress?.completed
    ? 100
    : progress && video.durationSeconds
      ? Math.min(
          100,
          Math.round((progress.positionSeconds / video.durationSeconds) * 100)
        )
      : 0;
  const duration = formatDuration(video.durationSeconds);

  // The ⋮ menu is a sibling of (not inside) the Link — a button nested in
  // an anchor is invalid interactive-in-interactive markup and its clicks
  // would navigate.
  return (
    // No `group` here — the ⋮ menu trigger is this div's child too, and an
    // outer group would fire the card's group-hover lift when hovering it.
    <div className="relative">
      <Link
        href={href}
        className="group block rounded-[32px] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
      >
        <Card className="overflow-hidden border-0 shadow-lg rounded-[32px] bg-white transition-transform duration-300 motion-safe:group-hover:-translate-y-2 motion-safe:active:scale-[0.98]">
          <div className="relative aspect-video">
            <img
              src={video.thumbnail}
              className="w-full h-full object-cover"
              alt=""
              loading={eager ? "eager" : "lazy"}
              decoding="async"
            />
            {reaction && (
              <div className="absolute top-3 left-3 w-9 h-9 bg-white/90 rounded-full flex items-center justify-center shadow">
                <span className="sr-only">
                  {reaction === "like" ? "Liked" : "Disliked"}
                </span>
                {reaction === "like" ? (
                  <Heart weight="fill" className="text-primary" size={20} />
                ) : (
                  <ThumbsDown weight="fill" className="text-red-500" size={20} />
                )}
              </div>
            )}
            <div
              className={cn(
                "absolute inset-0 flex items-center justify-center",
                "opacity-0 motion-safe:transition motion-safe:duration-200",
                "group-hover:opacity-100 group-focus-visible:opacity-100",
                "motion-safe:scale-75 motion-safe:group-hover:scale-100",
                "motion-safe:group-focus-visible:scale-100"
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-center rounded-full bg-primary shadow-lg",
                  compact ? "h-12 w-12" : "h-16 w-16"
                )}
              >
                <Play
                  weight="fill"
                  color="white"
                  size={compact ? 22 : 30}
                />
              </div>
            </div>
            {pct > 0 && (
              <div
                className="absolute bottom-0 left-0 h-1.5 bg-red-600"
                style={{ width: `${pct}%` }}
              />
            )}
            {duration && (
              <span className="absolute bottom-2 right-2 rounded-lg bg-black/75 px-2 py-0.5 text-sm font-bold text-white tabular-nums">
                {duration}
              </span>
            )}
          </div>
          <CardContent className={compact ? "p-4" : "p-6"}>
            <h3
              className={cn(
                "font-bold line-clamp-2 text-slate-900 group-hover:underline",
                compact ? "text-base sm:text-lg" : "text-xl",
                "leading-tight"
              )}
            >
              {video.title}
            </h3>
            <p className="text-slate-500 mt-2 font-medium">{video.channelTitle}</p>
          </CardContent>
        </Card>
      </Link>
      <VideoCardMenu
        profileId={profileId}
        videoId={video.id}
        playlistId={playlistId}
      />
    </div>
  );
}
