import type { Icon } from "@phosphor-icons/react";
import {
  ClockCounterClockwise,
  Heart,
  MonitorPlay,
  Play,
  Playlist,
  Sparkle,
} from "@phosphor-icons/react/dist/ssr";
import type { KidsFeedParams, KidsView } from "@/lib/kids-feed";

interface KidsViewConfig {
  label: string;
  icon: Icon;
  // Title shown when the view isn't drilled in and no search is active.
  title: string;
  placeholder: (profileName: string, feed: KidsFeedParams) => string;
}

// The six kids feeds, in tab order. Everything per-view that the shell or
// views need — labels, icons, default titles, search placeholders — lives
// here so the page no longer carries parallel ternary chains.
export const KIDS_VIEWS: Record<KidsView, KidsViewConfig> = {
  foryou: {
    label: "For You",
    icon: Sparkle,
    title: "Picked for You",
    placeholder: (profileName) => `Search ${profileName}'s picks...`,
  },
  videos: {
    label: "Videos",
    icon: Play,
    title: "Approved Videos",
    placeholder: (profileName) => `Search ${profileName}'s videos...`,
  },
  channels: {
    label: "Channels",
    icon: MonitorPlay,
    title: "Channels",
    placeholder: (profileName, feed) =>
      feed.channel
        ? `Search ${profileName}'s videos...`
        : `Search ${profileName}'s channels...`,
  },
  liked: {
    label: "Liked",
    icon: Heart,
    title: "Liked Videos",
    placeholder: (profileName) => `Search ${profileName}'s videos...`,
  },
  playlists: {
    label: "Playlists",
    icon: Playlist,
    title: "Playlists",
    placeholder: (profileName, feed) =>
      feed.list
        ? "Search this playlist..."
        : `Search ${profileName}'s playlists...`,
  },
  history: {
    label: "History",
    icon: ClockCounterClockwise,
    title: "History",
    placeholder: (profileName) => `Search ${profileName}'s history...`,
  },
};

// The view's heading: drill-in names win over a search title, which wins
// over the view's default. A ?date= filter qualifies the History title.
export function feedTitle(
  feed: KidsFeedParams,
  {
    channelTitle,
    playlistName,
  }: { channelTitle?: string | null; playlistName?: string | null } = {}
): string {
  if (feed.view === "channels" && feed.channel !== null) {
    return channelTitle ?? "Channel";
  }
  if (feed.view === "playlists" && feed.list !== null) {
    return playlistName ?? "Playlist";
  }
  if (feed.q) return `Results for "${feed.q}"`;
  const title = KIDS_VIEWS[feed.view].title;
  return feed.view === "history" && feed.date
    ? `${title} — ${feed.date}`
    : title;
}

export function searchPlaceholder(
  feed: KidsFeedParams,
  profileName: string
): string {
  return KIDS_VIEWS[feed.view].placeholder(profileName, feed);
}
