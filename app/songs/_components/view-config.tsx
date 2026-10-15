import type { Icon } from "@phosphor-icons/react";
import {
  Disc,
  MusicNotes,
  Star,
} from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import type { SongsFeedParams, SongsView } from "@/lib/songs-feed";

interface SongsViewConfig {
  label: string;
  icon: Icon;
  // Title shown when the view isn't drilled in and no search is active.
  title: string;
  placeholder: (feed: SongsFeedParams) => string;
}

// The catalog's views, in tab order. "mine" only becomes a tab when a
// parent session exists — the parser coerces it to "songs" otherwise.
export const SONGS_VIEWS: Record<SongsView, SongsViewConfig> = {
  songs: {
    label: "Songs",
    icon: MusicNotes,
    title: "All songs",
    placeholder: (feed) =>
      feed.video ? "Search this compilation..." : "Search songs...",
  },
  compilations: {
    label: "Compilations",
    icon: Disc,
    title: "Compilations",
    placeholder: () => "Search compilations...",
  },
  mine: {
    label: "Yours",
    icon: Star,
    title: "Your imports",
    placeholder: () => "Search your songs...",
  },
};

// The view's heading: the compilation drill-in name wins over a search
// title, which wins over the view's default.
export function feedTitle(
  feed: SongsFeedParams,
  { videoTitle }: { videoTitle?: string | null } = {}
): string {
  if (feed.view === "songs" && feed.video !== null) {
    return videoTitle ?? "Compilation";
  }
  if (feed.q) return `Results for "${feed.q}"`;
  return SONGS_VIEWS[feed.view].title;
}

export function searchPlaceholder(feed: SongsFeedParams): string {
  return SONGS_VIEWS[feed.view].placeholder(feed);
}

// Tab strip icons — the active tab's icon fills in.
export function tabIcon(key: SongsView, active: boolean): ReactNode {
  const ViewIcon = SONGS_VIEWS[key].icon;
  return <ViewIcon size={22} weight={active ? "fill" : "bold"} />;
}
