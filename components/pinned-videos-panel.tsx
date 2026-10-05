"use client";

import { useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { Input } from "./ui/input";
import { SubmitButton } from "./submit-button";
import { Button } from "./ui/button";
import { unpinVideo } from "@/app/actions/pinning";

export interface PinnedVideoItem {
  id: string;
  title: string;
  thumbnail: string;
}

// Profiles can accumulate thousands of approved videos via channel sync —
// rendering every card+form server-side made each dashboard navigation take
// seconds. Render a window of the list instead; filtering and "show all"
// happen client-side against the already-loaded slim rows.
const PAGE_SIZE = 50;

export function PinnedVideosPanel({
  videos,
  profileId,
}: {
  videos: PinnedVideoItem[];
  profileId: string;
}) {
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState(false);

  const q = filter.trim().toLowerCase();
  const filtered = q
    ? videos.filter((v) => v.title.toLowerCase().includes(q))
    : videos;
  const shown = expanded ? filtered : filtered.slice(0, PAGE_SIZE);
  const hiddenCount = filtered.length - shown.length;

  return (
    <div className="space-y-4">
      {videos.length > PAGE_SIZE && (
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${videos.length} approved videos…`}
          className="h-9 text-sm"
        />
      )}
      {shown.map((v) => (
        <div key={v.id} className="flex gap-3 group items-center">
          <img src={v.thumbnail} className="w-16 h-10 object-cover rounded shadow-sm" alt="" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{v.title}</p>
          </div>
          <form action={unpinVideo.bind(null, profileId, v.id)}>
            <SubmitButton variant="ghost" size="icon-touch" aria-label={`Unpin ${v.title}`} className="text-destructive opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
              <Trash size={20} />
            </SubmitButton>
          </form>
        </div>
      ))}
      {filtered.length === 0 && videos.length > 0 && (
        <p className="text-sm text-muted-foreground italic">
          No approved videos match &ldquo;{filter}&rdquo;.
        </p>
      )}
      {hiddenCount > 0 && !expanded && (
        <Button
          variant="ghost"
          className="w-full text-muted-foreground"
          onClick={() => setExpanded(true)}
        >
          Show all {filtered.length} videos
        </Button>
      )}
      {expanded && filtered.length > PAGE_SIZE && (
        <Button
          variant="ghost"
          className="w-full text-muted-foreground"
          onClick={() => setExpanded(false)}
        >
          Show less
        </Button>
      )}
    </div>
  );
}
