import { Play } from "@phosphor-icons/react/dist/ssr";
import { Card, CardContent } from "@/components/ui/card";
import { formatDuration } from "@/lib/format";
import type { FeedSong } from "@/lib/songs-feed";
import { cn } from "@/lib/utils";
import { SongCardMenu } from "./song-card-menu";

interface SongCardProps {
  song: FeedSong;
  // Session user's id — the ⋮ delete menu renders only on rows this
  // user imported. Null/undefined (or a mismatch) means no affordance.
  userId?: string | null;
  // The first above-the-fold cards load eagerly; the rest stay lazy.
  eager?: boolean;
  // "compact" is the denser variant for horizontal shelf rows.
  size?: "default" | "compact";
}

// A catalog song row as a card: the compilation's thumbnail with a
// hover play affordance, the song title, and the compilation title plus
// an "m:ss – m:ss" range badge (open-ended songs borrow the video's
// duration, and a missing one shows "end"). In-app segment playback is
// a documented seam — until the watch page learns ?song=<uuid>, the
// whole card is an external YouTube deep-link at the song's start.
export function SongCard({
  song,
  userId,
  eager = false,
  size = "default",
}: SongCardProps) {
  const compact = size === "compact";
  const canDelete = userId != null && song.importedBy === userId;

  const start = formatDuration(song.startSeconds) ?? "0:00";
  const endSeconds = song.endSeconds ?? song.videoDuration;
  const range = `${start} – ${endSeconds ? formatDuration(endSeconds) : "end"}`;
  const href = `https://www.youtube.com/watch?v=${song.videoId}&t=${song.startSeconds}s`;

  return (
    // No `group` here — the ⋮ menu trigger is this div's child too, and
    // an outer group would fire the card's group-hover lift when
    // hovering it.
    <div className="relative">
      {/* Plain <a>, not <Link> — this is an external YouTube deep-link. */}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="group block rounded-[32px] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
      >
        <Card className="overflow-hidden border-0 shadow-lg rounded-[32px] bg-white transition-transform duration-300 motion-safe:group-hover:-translate-y-2 motion-safe:active:scale-[0.98]">
          <div className="relative aspect-video">
            <img
              src={song.thumbnail}
              className="w-full h-full object-cover"
              alt=""
              loading={eager ? "eager" : "lazy"}
              decoding="async"
            />
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
          </div>
          <CardContent className={compact ? "p-4" : "p-6"}>
            <h3
              className={cn(
                "font-bold line-clamp-2 text-slate-900 group-hover:underline",
                compact ? "text-base sm:text-lg" : "text-xl",
                "leading-tight"
              )}
            >
              {song.title}
            </h3>
            <div className="mt-2 flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate font-medium text-slate-500">
                {song.videoTitle}
              </p>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold tabular-nums text-slate-600">
                {range}
              </span>
            </div>
          </CardContent>
        </Card>
      </a>
      {/* The ⋮ menu is a sibling of (not inside) the anchor — a button
          nested in a link is invalid interactive-in-interactive markup
          and its clicks would navigate. */}
      {canDelete && <SongCardMenu songId={song.id} />}
    </div>
  );
}
