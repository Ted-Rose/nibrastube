import { and, asc, count, desc, eq, ilike, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  channels,
  videos,
  watchProgress,
  whitelistedChannels,
  whitelistedVideos,
} from "@/lib/db/schema";

export type KidsView = "videos" | "channels";
export type KidsSort = "age" | "status";
export type KidsDir = "asc" | "desc";

export interface KidsFeedParams {
  view: KidsView;
  channel: string | null;
  sort: KidsSort;
  dir: KidsDir;
  q: string;
}

const CHANNEL_ID_RE = /^[\w-]+$/;

// Validates raw searchParams; bad values fall back to defaults.
export function parseKidsFeedParams(
  raw: Record<string, string | string[] | undefined>
): KidsFeedParams {
  const first = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v) ?? "";
  const view: KidsView = first(raw.view) === "channels" ? "channels" : "videos";
  const rawChannel = first(raw.channel);
  const channel =
    view === "channels" && CHANNEL_ID_RE.test(rawChannel) ? rawChannel : null;
  const sort: KidsSort = first(raw.sort) === "status" ? "status" : "age";
  const dir: KidsDir = first(raw.dir) === "asc" ? "asc" : "desc";
  return { view, channel, sort, dir, q: first(raw.q) };
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
  if (next.sort !== "age") sp.set("sort", next.sort);
  if (next.dir !== "desc") sp.set("dir", next.dir);
  if (next.q) sp.set("q", next.q);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
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
  // 0 = not watched, 1 = started/not finished, 2 = watched
  const statusRank = sql<number>`case
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
    .select({ video: videos, progress: watchProgress })
    .from(whitelistedVideos)
    .innerJoin(videos, eq(videos.id, whitelistedVideos.videoId))
    .leftJoin(
      watchProgress,
      and(
        eq(watchProgress.profileId, whitelistedVideos.profileId),
        eq(watchProgress.videoId, whitelistedVideos.videoId)
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
      channelTitle: videos.channelTitle,
      videoCount: count(videos.id),
    })
    .from(whitelistedVideos)
    .innerJoin(videos, eq(videos.id, whitelistedVideos.videoId))
    .where(
      and(
        eq(whitelistedVideos.profileId, profileId),
        isNotNull(videos.channelId),
        q ? ilike(videos.channelTitle, `%${q}%`) : undefined
      )
    )
    .groupBy(videos.channelId, videos.channelTitle);

  const approved = await db
    .select({ channel: channels })
    .from(whitelistedChannels)
    .innerJoin(channels, eq(whitelistedChannels.channelId, channels.id))
    .where(
      and(
        eq(whitelistedChannels.profileId, profileId),
        q ? ilike(channels.title, `%${q}%`) : undefined
      )
    );

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

  return [...result.values()].sort((a, b) => a.title.localeCompare(b.title));
}
