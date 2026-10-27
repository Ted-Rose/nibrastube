import Link from "next/link";
import {
  Play,
  Prohibit,
  PushPin,
} from "@phosphor-icons/react/dist/ssr";
import { pinVideo } from "@/app/actions/pinning";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DashboardVideo } from "@/lib/youtube";

// One vetting card for the parent dashboard — shared by the search
// results grid and the channel drill-in's uploads list so the duration
// badge / Blocked label are written once. Server-safe: no state, the
// pin action binds straight into the <form>.
//
// Age-restricted videos (channel uploads only — search filters them
// out) render a "Blocked" state with the pin disabled: the pin would be
// an inert row since `suitableVideo` floors them out of every kids
// surface. Same treatment as PinnedVideosPanel's dead-pin label.
export function DashboardVideoCard({
  video,
  pinned,
  profileId,
  profileName,
  previewHref,
}: {
  video: DashboardVideo;
  pinned: boolean;
  profileId: string;
  profileName: string;
  // Dashboard URL with &video=<id> appended by the caller — keeps the
  // current q/type/channel context so closing restores the view.
  previewHref: string;
}) {
  const duration = formatDuration(video.durationSeconds);
  return (
    <Card
      className={cn(
        "overflow-hidden group transition-all flex flex-col",
        "hover:ring-2 hover:ring-primary/40"
      )}
    >
      <div className="relative aspect-video">
        <img
          src={video.thumbnail}
          className="w-full h-full object-cover"
          alt={video.title}
        />
        <div
          className={cn(
            // Always visible on touch (no hover to reveal it); on
            // md+ it fades in on card hover like the sibling
            // submit-button affordances.
            "absolute inset-0 bg-black/40 flex items-center",
            "justify-center opacity-100 transition-opacity",
            "md:opacity-0 md:group-hover:opacity-100"
          )}
        >
          <Link
            href={previewHref}
            scroll={false}
            aria-label={`Preview ${video.title}`}
            className={cn(
              "text-white bg-black/60 p-2 rounded-full",
              "hover:bg-black/80 transition-colors"
            )}
          >
            <Play size={32} weight="fill" />
          </Link>
        </div>
        {duration && (
          <span
            className={cn(
              "absolute bottom-2 right-2 rounded-lg bg-black/75",
              "px-2 py-0.5 text-sm font-bold text-white tabular-nums"
            )}
          >
            {duration}
          </span>
        )}
      </div>
      <CardHeader className="p-4 flex-1">
        <CardTitle className="text-sm line-clamp-2 leading-snug">
          <Link
            href={previewHref}
            scroll={false}
            className={cn(
              "rounded-sm hover:underline",
              "focus-visible:outline-none",
              "focus-visible:ring-2 focus-visible:ring-primary/40"
            )}
          >
            {video.title}
          </Link>
        </CardTitle>
        <CardDescription className="text-xs">
          {video.channelTitle}
        </CardDescription>
        {video.ageRestricted === true && (
          <p className="text-[11px] font-medium text-destructive">
            Blocked — YouTube marks this video 18+, so it can never play
            for kids.
          </p>
        )}
      </CardHeader>
      <CardFooter className="p-4 pt-0">
        {pinned ? (
          <Button
            disabled
            className={cn(
              "w-full bg-green-100 text-green-700 border-green-200",
              "hover:bg-green-100"
            )}
          >
            <PushPin size={18} className="mr-2" /> Approved
          </Button>
        ) : video.ageRestricted === true ? (
          <Button
            disabled
            className={cn(
              "w-full bg-red-100 text-red-700 border-red-200",
              "hover:bg-red-100"
            )}
          >
            <Prohibit size={18} className="mr-2" /> Blocked
          </Button>
        ) : (
          <form
            action={pinVideo.bind(null, profileId, video.id)}
            className="w-full"
          >
            <SubmitButton
              variant="outline"
              size="touch"
              pendingLabel="Pinning…"
              className={cn(
                "w-full transition-colors",
                "hover:bg-primary hover:text-white"
              )}
            >
              Pin to {profileName}
            </SubmitButton>
          </form>
        )}
      </CardFooter>
    </Card>
  );
}
