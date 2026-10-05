import Link from "next/link";
import { Heart, Play, ThumbsDown } from "@phosphor-icons/react/dist/ssr";
import { Card, CardContent } from "@/components/ui/card";
import type { watchProgress } from "@/lib/db/schema";
import type { FeedVideo, VideoReaction } from "@/lib/kids-feed";

interface VideoCardProps {
  href: string;
  video: FeedVideo;
  progress: typeof watchProgress.$inferSelect | null;
  reaction?: VideoReaction | null;
}

export function VideoCard({ href, video, progress, reaction }: VideoCardProps) {
  const pct = progress?.completed
    ? 100
    : progress && video.durationSeconds
      ? Math.min(
          100,
          Math.round((progress.positionSeconds / video.durationSeconds) * 100)
        )
      : 0;

  return (
    <Link href={href} className="group">
      <Card className="overflow-hidden border-0 shadow-lg rounded-[32px] group-hover:-translate-y-2 transition-transform duration-300 bg-white">
        <div className="relative aspect-video">
          <img
            src={video.thumbnail}
            className="w-full h-full object-cover"
            alt={video.title}
          />
          <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-colors" />
          {reaction && (
            <div className="absolute top-3 left-3 w-9 h-9 bg-white/90 rounded-full flex items-center justify-center shadow">
              {reaction === "like" ? (
                <Heart weight="fill" className="text-primary" size={20} />
              ) : (
                <ThumbsDown weight="fill" className="text-red-500" size={20} />
              )}
            </div>
          )}
          {pct > 0 && (
            <div
              className="absolute bottom-0 left-0 h-1.5 bg-red-600"
              style={{ width: `${pct}%` }}
            />
          )}
          <div className="absolute bottom-4 right-4 w-12 h-12 bg-primary rounded-full flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
            <Play weight="fill" color="white" size={24} />
          </div>
        </div>
        <CardContent className="p-6">
          <h3 className="text-xl font-bold line-clamp-2 leading-tight text-slate-900 group-hover:underline">
            {video.title}
          </h3>
          <p className="text-slate-500 mt-2 font-medium">{video.channelTitle}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
