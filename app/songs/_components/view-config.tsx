import type { Icon } from "@phosphor-icons/react";
import {
  Disc,
  Heart,
  MusicNotes,
  Star,
} from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import {
  songsCatalogUrl,
  type SongsFeedParams,
  type SongsView,
} from "@/lib/songs-feed";

interface SongsViewConfig {
  label: string;
  icon: Icon;
  // Title shown when the view isn't drilled in and no search is active.
  title: string;
  placeholder: (feed: SongsFeedParams) => string;
}

// The catalog's views, in tab order. "liked" only becomes a tab when
// a kid profile resolves (kid session or lock cookie) and "mine" only
// for a parent session — the parser coerces both to "songs" otherwise.
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
  liked: {
    label: "Liked",
    icon: Heart,
    title: "Liked songs",
    placeholder: () => "Search liked songs...",
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

// Sort chip order — default (recent:desc = Newest) first. songsFeedQuery
// drops default sort/dir values, so the default chip's href stays clean.
// Shared by the song-grid views; on Liked "recent" means recently
// reacted.
const SORT_OPTIONS = [
  { sort: "recent", dir: "desc", label: "Newest" },
  { sort: "recent", dir: "asc", label: "Oldest" },
  { sort: "title", dir: "asc", label: "A–Z" },
  { sort: "title", dir: "desc", label: "Z–A" },
  { sort: "length", dir: "asc", label: "Shortest" },
  { sort: "length", dir: "desc", label: "Longest" },
] as const;

export function sortOptions(feed: SongsFeedParams) {
  return SORT_OPTIONS.map((o) => ({
    key: `${o.sort}:${o.dir}`,
    label: o.label,
    href: songsCatalogUrl(feed, { sort: o.sort, dir: o.dir }),
    active: o.sort === feed.sort && o.dir === feed.dir,
  }));
}

// Tab strip icons — the active tab's icon fills in.
export function tabIcon(key: SongsView, active: boolean): ReactNode {
  const ViewIcon = SONGS_VIEWS[key].icon;
  return <ViewIcon size={22} weight={active ? "fill" : "bold"} />;
}
