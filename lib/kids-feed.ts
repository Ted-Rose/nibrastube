import { and, asc, count, desc, eq, ilike, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  channels,
  playlistItems,
  playlists,
  videoReactions,
  videos,
  watchProgress,
  whitelistedChannels,
  whitelistedVideos,
} from "@/lib/db/schema";

export type KidsView = "videos" | "channels" | "liked" | "playlists";
export type VideoReaction = "like" | "dislike";
export type KidsSort = "age" | "status";
export type KidsDir = "asc" | "desc";

export interface KidsFeedParams {
  view: KidsView;
  channel: string | null;
  // Selected playlist id — only meaningful when view === "playlists".
  list: string | null;
  sort: KidsSort;
  dir: KidsDir;
  q: string;
}

const CHANNEL_ID_RE = /^[\w-]+$/;
const PLAYLIST_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Validates raw searchParams; bad values fall back to defaults.
export function parseKidsFeedParams(
  raw: Record<string, string | string[] | undefined>
): KidsFeedParams {
  const first = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v) ?? "";
  const rawView = first(raw.view);
  const view: KidsView =
    rawView === "channels" || rawView === "liked" || rawView === "playlists"
      ? rawView
      : "videos";
  const rawChannel = first(raw.channel);
  const channel =
    view === "channels" && CHANNEL_ID_RE.test(rawChannel) ? rawChannel : null;
  const rawList = first(raw.list);
  const list =
    view === "playlists" && PLAYLIST_ID_RE.test(rawList) ? rawList : null;
  const sort: KidsSort = first(raw.sort) === "age" ? "age" : "status";
  const dir: KidsDir = first(raw.dir) === "desc" ? "desc" : "asc";
  return { view, channel, list, sort, dir, q: first(raw.q) };
}

// Query string (with leading "?", or "") carrying every non-default param.
export function kidsFeedQuery(
  params: KidsFeedParams,
  overrides: Partial<KidsFeedParams> = {}
): string {
  const next = { ...params, ...overrides };
  const sp = new URLSearchParams();
  if (next.view !== "videos") sp.set("view", next.view);
  if (next.view === "channels" && next.channel)
    sp.set("channel", next.channel);
  if (next.view === "playlists" && next.list) sp.set("list", next.list);
  if (next.sort !== "status") sp.set("sort", next.sort);
  if (next.dir !== "asc") sp.set("dir", next.dir);
  if (next.q) sp.set("q", next.q);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export type WatchStatus = 0 | 1 | 2; // 0 new, 1 started, 2 watched

// Only the columns the feed grid and the watch-page playlist actually
// render. The full `videos` row carries description/tags/raw JSONB
// (~9KB/row); fetching it for ~2k whitelisted videos made every feed
// render multi-second and multi-megabyte.
const feedVideoCols = {
  id: videos.id,
  title: videos.title,
  thumbnail: videos.thumbnail,
  channelTitle: videos.channelTitle,
  durationSeconds: videos.durationSeconds,
};

export interface FeedVideo {
  id: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  durationSeconds: number | null;
}

// JS mirror of the statusRank CASE below — same tiers, so autoplay picks
// match what the sort=status grid shows.
export function watchStatus(
  progress: { positionSeconds: number; completed: boolean } | null
): WatchStatus {
  if (progress?.completed) return 2;
  if (progress && progress.positionSeconds > 0) return 1;
  return 0;
}

// Whitelisted videos + watch progress for a profile, optionally filtered by
// title (q) and/or publishing channel, ordered per sort/dir.
export async function getKidsVideos(
  profileId: string,
  {
    q,
    channelId,
    sort,
    dir,
  }: { q?: string; channelId?: string | null; sort: KidsSort; dir: KidsDir }
) {
  // 0 = not watched, 1 = started/not finished, 2 = watched or disliked
  const statusRank = sql<number>`case
    when ${videoReactions.reaction} = 'dislike' then 2
    when ${watchProgress.completed} then 2
    when ${watchProgress.positionSeconds} > 0 then 1
    else 0 end`;
  const newestFirst = sql`${videos.publishedAt} desc nulls last`;
  const orderBy =
    sort === "status"
      ? dir === "asc"
        ? [asc(statusRank), newestFirst]
        : [desc(statusRank), newestFirst]
      : dir === "asc"
        ? [sql`${videos.publishedAt} asc nulls last`]
        : [newestFirst];

  return db
    .select({
      video: feedVideoCols,
      progress: watchProgress,
      reaction: sql<VideoReaction | null>`${videoReactions.reaction}`,
    })
    .from(whitelistedVideos)
    .innerJoin(videos, eq(videos.id, whitelistedVideos.videoId))
    .leftJoin(
      watchProgress,
      and(
        eq(watchProgress.profileId, whitelistedVideos.profileId),
        eq(watchProgress.videoId, whitelistedVideos.videoId)
      )
    )
    .leftJoin(
      videoReactions,
      and(
        eq(videoReactions.profileId, whitelistedVideos.profileId),
        eq(videoReactions.videoId, whitelistedVideos.videoId)
      )
    )
    .where(
      and(
        eq(whitelistedVideos.profileId, profileId),
        q ? ilike(videos.title, `%${q}%`) : undefined,
        channelId ? eq(videos.channelId, channelId) : undefined
      )
    )
    .orderBy(...orderBy);
}

// Videos the kid tapped 👍 on, newest reaction first. Inner-joins
// whitelisted_videos so an unpinned favorite hides until re-pinned.
// Same { video, progress, reaction } row shape as getKidsVideos.
export async function getLikedVideos(
  profileId: string,
  { q }: { q?: string } = {}
) {
  return db
    .select({
      video: feedVideoCols,
      progress: watchProgress,
      reaction: sql<VideoReaction>`${videoReactions.reaction}`,
    })
    .from(videoReactions)
    .innerJoin(videos, eq(videos.id, videoReactions.videoId))
    .innerJoin(
      whitelistedVideos,
      and(
        eq(whitelistedVideos.profileId, videoReactions.profileId),
        eq(whitelistedVideos.videoId, videoReactions.videoId)
      )
    )
    .leftJoin(
      watchProgress,
      and(
        eq(watchProgress.profileId, videoReactions.profileId),
        eq(watchProgress.videoId, videoReactions.videoId)
      )
    )
    .where(
      and(
        eq(videoReactions.profileId, profileId),
        eq(videoReactions.reaction, "like"),
        q ? ilike(videos.title, `%${q}%`) : undefined
      )
    )
    .orderBy(desc(videoReactions.reactedAt));
}

export interface KidsChannel {
  id: string;
  title: string;
  thumbnail: string | null;
  videoCount: number;
}

// One card per channel that has whitelisted videos (grouped by the video's
// real publisher, so manual pins count too), plus approved channels with 0
// videos yet (mid-backfill). Thumbnails come from the channels registry.
export async function getKidsChannels(
  profileId: string,
  { q }: { q?: string } = {}
): Promise<KidsChannel[]> {
  const grouped = await db
    .select({
      channelId: videos.channelId,
      // Titles can drift across cached rows after a channel rename — group by
      // id only and take any title, or one channel would yield several cards.
      channelTitle: sql<string>`max(${videos.channelTitle})`,
      videoCount: count(videos.id),
    })
    .from(whitelistedVideos)
    .innerJoin(videos, eq(videos.id, whitelistedVideos.videoId))
    .where(
      and(
        eq(whitelistedVideos.profileId, profileId),
        isNotNull(videos.channelId)
      )
    )
    .groupBy(videos.channelId);

  const approved = await db
    .select({ channel: channels })
    .from(whitelistedChannels)
    .innerJoin(channels, eq(whitelistedChannels.channelId, channels.id))
    .where(eq(whitelistedChannels.profileId, profileId));

  const ids = [
    ...new Set([
      ...grouped.map((g) => g.channelId).filter((id): id is string => !!id),
      ...approved.map((a) => a.channel.id),
    ]),
  ];
  const registry = ids.length
    ? await db.query.channels.findMany({ where: inArray(channels.id, ids) })
    : [];
  const thumbnails = new Map(registry.map((c) => [c.id, c.thumbnail]));

  const result = new Map<string, KidsChannel>();
  for (const g of grouped) {
    if (!g.channelId) continue;
    result.set(g.channelId, {
      id: g.channelId,
      title: g.channelTitle,
      thumbnail: thumbnails.get(g.channelId) ?? null,
      videoCount: g.videoCount,
    });
  }
  for (const { channel } of approved) {
    const existing = result.get(channel.id);
    if (existing) {
      existing.thumbnail = channel.thumbnail ?? existing.thumbnail;
    } else {
      result.set(channel.id, {
        id: channel.id,
        title: channel.title,
        thumbnail: channel.thumbnail,
        videoCount: 0,
      });
    }
  }

  // Filter after merging so q matches the displayed title regardless of
  // which source (videos.channelTitle vs channels.title) it came from.
  const needle = q?.toLowerCase();
  const all = [...result.values()].filter(
    (c) => !needle || c.title.toLowerCase().includes(needle)
  );
  return all.sort((a, b) => a.title.localeCompare(b.title));
}

export interface KidsPlaylist {
  id: string;
  name: string;
  videoCount: number;
  coverThumbnail: string | null;
}

// Playlists for a profile with their VISIBLE item count (items whose video
// is currently unpinned don't count) and a cover taken from the first
// visible item — same unpin-hides semantics as getPlaylistVideos.
export async function getPlaylists(
  profileId: string
): Promise<KidsPlaylist[]> {
  return db
    .select({
      id: playlists.id,
      name: playlists.name,
      videoCount: count(whitelistedVideos.videoId),
      coverThumbnail: sql<string | null>`(
        array_agg(${videos.thumbnail} order by ${playlistItems.position} asc)
        filter (where ${videos.thumbnail} is not null)
      )[1]`,
    })
    .from(playlists)
    .leftJoin(
      playlistItems,
      eq(playlistItems.playlistId, playlists.id)
    )
    .leftJoin(
      whitelistedVideos,
      and(
        eq(whitelistedVideos.profileId, playlists.profileId),
        eq(whitelistedVideos.videoId, playlistItems.videoId)
      )
    )
    .leftJoin(videos, eq(videos.id, whitelistedVideos.videoId))
    .where(eq(playlists.profileId, profileId))
    .groupBy(playlists.id, playlists.name, playlists.createdAt)
    .orderBy(asc(playlists.createdAt));
}

// One playlist's videos in kid-defined order. Same { video, progress,
// reaction } row shape as getKidsVideos. Rows inner-join
// whitelisted_videos on the playlist's profile, so an unpinned video hides
// (and returns at its old position on re-pin) and a playlist belonging to
// another profile returns nothing.
export async function getPlaylistVideos(
  profileId: string,
  playlistId: string,
  { q }: { q?: string } = {}
) {
  const playlist = await db.query.playlists.findFirst({
    where: and(
      eq(playlists.id, playlistId),
      eq(playlists.profileId, profileId)
    ),
  });
  if (!playlist) return [];

  return db
    .select({
      video: feedVideoCols,
      progress: watchProgress,
      reaction: sql<VideoReaction | null>`${videoReactions.reaction}`,
    })
    .from(playlistItems)
    .innerJoin(videos, eq(videos.id, playlistItems.videoId))
    .innerJoin(
      whitelistedVideos,
      and(
        eq(whitelistedVideos.profileId, profileId),
        eq(whitelistedVideos.videoId, playlistItems.videoId)
      )
    )
    .leftJoin(
      watchProgress,
      and(
        eq(watchProgress.profileId, profileId),
        eq(watchProgress.videoId, playlistItems.videoId)
      )
    )
    .leftJoin(
      videoReactions,
      and(
        eq(videoReactions.profileId, profileId),
        eq(videoReactions.videoId, playlistItems.videoId)
      )
    )
    .where(
      and(
        eq(playlistItems.playlistId, playlistId),
        q ? ilike(videos.title, `%${q}%`) : undefined
      )
    )
    .orderBy(asc(playlistItems.position));
}
