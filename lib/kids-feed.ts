import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { cache } from "react";
import { db } from "@/lib/db";
import {
  channels,
  playlistItems,
  playlists,
  videoReactions,
  videos,
  watchHistory,
  watchProgress,
  whitelistedChannels,
  whitelistedVideos,
} from "@/lib/db/schema";
// The 18+ hard floor — every video-returning query below ANDs this in,
// so an age-restricted pin is inert on every kids surface (and on the
// watch page, which builds its queue from these functions).
import { suitableVideo } from "@/lib/video-suitability";

export type KidsView =
  | "videos"
  | "channels"
  | "liked"
  | "playlists"
  | "history"
  | "foryou"
  | "shorts";
export type VideoReaction = "like" | "dislike";
export type KidsSort = "added" | "age" | "status";
export type KidsDir = "asc" | "desc";
// "all" = shorts + long-form together (the default — never emitted in
// the URL); "videos"/"shorts" filter every video list by is_short.
export type KidsType = "all" | "videos" | "shorts";

// Empty-state phrasing for a ?min=/?max= length bound — "under 10
// minutes", "over 5 minutes", "between 5 minutes and 10 minutes".
export function maxLenLabel(seconds: number): string {
  const mins = Math.round(seconds / 60);
  return mins >= 60 && mins % 60 === 0
    ? `${mins / 60} hour${mins === 60 ? "" : "s"}`
    : `${mins} minutes`;
}

// Same phrasing for the combined band — callers guard that at least
// one bound is set.
export function lenRangeLabel(
  minLen: number | null,
  maxLen: number | null
): string {
  if (minLen !== null && maxLen !== null)
    return `between ${maxLenLabel(minLen)} and ${maxLenLabel(maxLen)}`;
  if (minLen !== null) return `over ${maxLenLabel(minLen)}`;
  return `under ${maxLenLabel(maxLen ?? 0)}`;
}

export interface KidsFeedParams {
  view: KidsView;
  channel: string | null;
  // Selected playlist id — only meaningful when view === "playlists".
  list: string | null;
  // YYYY-MM-DD day filter — only meaningful when view === "history".
  date: string | null;
  sort: KidsSort;
  dir: KidsDir;
  type: KidsType;
  // Min/max duration_seconds bounds; null = that side unbounded.
  minLen: number | null;
  maxLen: number | null;
  q: string;
}

const CHANNEL_ID_RE = /^[\w-]+$/;
const PLAYLIST_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// DATE_RE alone passes impossible dates like 2026-02-30, which Postgres
// then rejects — a hand-edited ?date= would 500 the page. Roundtrip
// through Date to confirm the day actually exists on the calendar.
function isCalendarDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Validates raw searchParams; bad values fall back to defaults.
export function parseKidsFeedParams(
  raw: Record<string, string | string[] | undefined>
): KidsFeedParams {
  const first = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v) ?? "";
  const rawView = first(raw.view);
  const view: KidsView =
    rawView === "channels" ||
    rawView === "liked" ||
    rawView === "playlists" ||
    rawView === "history" ||
    rawView === "foryou" ||
    rawView === "shorts"
      ? rawView
      : "videos";
  const rawChannel = first(raw.channel);
  const channel =
    view === "channels" && CHANNEL_ID_RE.test(rawChannel) ? rawChannel : null;
  const rawList = first(raw.list);
  const list =
    view === "playlists" && PLAYLIST_ID_RE.test(rawList) ? rawList : null;
  const rawDate = first(raw.date);
  // Malformed or future dates fall back to the all-days view.
  const today = new Date().toLocaleDateString("en-CA");
  const date =
    view === "history" && isCalendarDate(rawDate) && rawDate <= today
      ? rawDate
      : null;
  const rawSort = first(raw.sort);
  const sort: KidsSort =
    rawSort === "age" || rawSort === "added" ? rawSort : "status";
  const dir: KidsDir = first(raw.dir) === "desc" ? "desc" : "asc";
  const rawType = first(raw.type);
  const type: KidsType =
    rawType === "videos" || rawType === "shorts" ? rawType : "all";
  // ?min=/?max= are seconds; junk/0 falls back to unbounded, each
  // clamped to 24h.
  const bound = (raw: string) => {
    const n = /^\d+$/.test(raw) ? Number(raw) : 0;
    return n > 0 ? Math.min(n, 86400) : null;
  };
  return {
    view,
    channel,
    list,
    date,
    sort,
    dir,
    type,
    minLen: bound(first(raw.min)),
    maxLen: bound(first(raw.max)),
    q: first(raw.q),
  };
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
  if (next.view === "history" && next.date) sp.set("date", next.date);
  if (next.sort !== "status") sp.set("sort", next.sort);
  if (next.dir !== "asc") sp.set("dir", next.dir);
  if (next.type !== "all") sp.set("type", next.type);
  if (next.minLen !== null) sp.set("min", String(next.minLen));
  if (next.maxLen !== null) sp.set("max", String(next.maxLen));
  if (next.q) sp.set("q", next.q);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

// Kids portal path for a feed — the single helper so tabs, sorts,
// drill-down and empty-state links never drop each other's params.
export function kidsPortalUrl(
  profileId: string,
  feed: KidsFeedParams,
  overrides: Partial<KidsFeedParams> = {}
): string {
  return `/kids/${profileId}${kidsFeedQuery(feed, overrides)}`;
}

export type WatchStatus = 0 | 1 | 2; // 0 new, 1 started, 2 watched

// WHERE fragment for the ?type= shorts/videos filter — undefined when
// "all" so and() drops it. is_short is NOT NULL (default false), so no
// null-handling is needed on the "videos" side.
const typeFilter = (type: KidsType | undefined) =>
  type === "shorts"
    ? eq(videos.isShort, true)
    : type === "videos"
      ? eq(videos.isShort, false)
      : undefined;

// WHERE fragment for the ?min=/?max= length band — and() drops the
// undefined side(s). duration_seconds is nullable; a NULL row can't
// be certified inside the band, so it drops out of bounded feeds.
const lenFilter = (
  minLen: number | null | undefined,
  maxLen: number | null | undefined
) =>
  and(
    minLen ? gte(videos.durationSeconds, minLen) : undefined,
    maxLen ? lte(videos.durationSeconds, maxLen) : undefined
  );

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
  isShort: videos.isShort,
};

export interface FeedVideo {
  id: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  durationSeconds: number | null;
  isShort: boolean;
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
    type,
    minLen,
    maxLen,
  }: {
    q?: string;
    channelId?: string | null;
    sort: KidsSort;
    dir: KidsDir;
    type?: KidsType;
    minLen?: number | null;
    maxLen?: number | null;
  }
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
      : sort === "added"
        ? // pinned_at = when the parent added it to the platform, not
          // the YouTube upload date. NOT NULL, so no nulls handling.
          dir === "asc"
          ? [asc(whitelistedVideos.pinnedAt)]
          : [desc(whitelistedVideos.pinnedAt)]
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
        suitableVideo,
        typeFilter(type),
        lenFilter(minLen, maxLen),
        q ? ilike(videos.title, `%${q}%`) : undefined,
        channelId ? eq(videos.channelId, channelId) : undefined
      )
    )
    .orderBy(...orderBy);
}

// Whitelisted videos the kid started but hasn't finished (and hasn't
// 👎'd), most recently watched first — the home "Continue watching"
// shelf. Same { video, progress, reaction } row shape as getKidsVideos;
// progress is an inner join because the shelf only lists started rows.
export async function getContinueWatching(
  profileId: string,
  {
    limit = 20,
    type,
    minLen,
    maxLen,
  }: {
    limit?: number;
    type?: KidsType;
    minLen?: number | null;
    maxLen?: number | null;
  } = {}
) {
  return db
    .select({
      video: feedVideoCols,
      progress: watchProgress,
      reaction: sql<VideoReaction | null>`${videoReactions.reaction}`,
    })
    .from(whitelistedVideos)
    .innerJoin(videos, eq(videos.id, whitelistedVideos.videoId))
    .innerJoin(
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
        suitableVideo,
        typeFilter(type),
        lenFilter(minLen, maxLen),
        gt(watchProgress.positionSeconds, 0),
        eq(watchProgress.completed, false),
        or(
          isNull(videoReactions.reaction),
          ne(videoReactions.reaction, "dislike")
        )
      )
    )
    .orderBy(desc(watchProgress.watchedAt))
    .limit(limit);
}

// Recently pinned whitelisted videos the kid hasn't finished or 👎'd —
// the home "New for you" shelf. The completed/disliked checks are
// null-safe because progress and reactions are left joins. Ordered by
// pin day then publish date: a channel backfill pins hundreds of rows
// within seconds, newest upload first, so a plain `pinnedAt desc` would
// surface the channel's OLDEST uploads.
export async function getNewForYou(
  profileId: string,
  {
    limit = 20,
    days = 14,
    type,
    minLen,
    maxLen,
  }: {
    limit?: number;
    days?: number;
    type?: KidsType;
    minLen?: number | null;
    maxLen?: number | null;
  } = {}
) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
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
        suitableVideo,
        typeFilter(type),
        lenFilter(minLen, maxLen),
        gte(whitelistedVideos.pinnedAt, cutoff),
        or(isNull(watchProgress.completed), eq(watchProgress.completed, false)),
        or(
          isNull(videoReactions.reaction),
          ne(videoReactions.reaction, "dislike")
        )
      )
    )
    .orderBy(
      sql`date_trunc('day', ${whitelistedVideos.pinnedAt}) desc`,
      sql`${videos.publishedAt} desc nulls last`
    )
    .limit(limit);
}

// Videos the kid tapped 👍 on, newest reaction first. Inner-joins
// whitelisted_videos so an unpinned favorite hides until re-pinned.
// Same { video, progress, reaction } row shape as getKidsVideos.
export async function getLikedVideos(
  profileId: string,
  {
    q,
    limit,
    type,
    minLen,
    maxLen,
  }: {
    q?: string;
    limit?: number;
    type?: KidsType;
    minLen?: number | null;
    maxLen?: number | null;
  } = {}
) {
  const query = db
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
        suitableVideo,
        typeFilter(type),
        lenFilter(minLen, maxLen),
        q ? ilike(videos.title, `%${q}%`) : undefined
      )
    )
    .orderBy(desc(videoReactions.reactedAt));
  return limit === undefined ? query : query.limit(limit);
}

// Everything a profile watched, one row per (video, kid-local day), newest
// day first then newest-first within the day. Same { video, progress,
// reaction } row shape as getKidsVideos plus watchedOn/lastSeenAt, so the
// watch page and card components reuse unchanged. Inner-joins
// whitelisted_videos — an unpinned video hides and returns on re-pin.
export async function getWatchHistory(
  profileId: string,
  {
    q,
    date,
    type,
    minLen,
    maxLen,
  }: {
    q?: string;
    date?: string;
    type?: KidsType;
    minLen?: number | null;
    maxLen?: number | null;
  } = {}
) {
  return db
    .select({
      video: feedVideoCols,
      progress: watchProgress,
      reaction: sql<VideoReaction | null>`${videoReactions.reaction}`,
      watchedOn: watchHistory.watchedOn,
      lastSeenAt: watchHistory.lastSeenAt,
    })
    .from(watchHistory)
    .innerJoin(videos, eq(videos.id, watchHistory.videoId))
    .innerJoin(
      whitelistedVideos,
      and(
        eq(whitelistedVideos.profileId, watchHistory.profileId),
        eq(whitelistedVideos.videoId, watchHistory.videoId)
      )
    )
    .leftJoin(
      watchProgress,
      and(
        eq(watchProgress.profileId, watchHistory.profileId),
        eq(watchProgress.videoId, watchHistory.videoId)
      )
    )
    .leftJoin(
      videoReactions,
      and(
        eq(videoReactions.profileId, watchHistory.profileId),
        eq(videoReactions.videoId, watchHistory.videoId)
      )
    )
    .where(
      and(
        eq(watchHistory.profileId, profileId),
        suitableVideo,
        typeFilter(type),
        lenFilter(minLen, maxLen),
        date ? eq(watchHistory.watchedOn, date) : undefined,
        q ? ilike(videos.title, `%${q}%`) : undefined
      )
    )
    .orderBy(desc(watchHistory.watchedOn), desc(watchHistory.lastSeenAt));
}

// "For You" — the profile's whitelisted videos ranked by predicted
// interest. Only videos the kid hasn't finished rank at all —
// completed watch_progress rows are filtered out in WHERE, so every
// recommendation is not-entirely-watched (in-progress counts).
// Scoring (see docs/kids-recommendations-plan.md):
//   channel_affinity = Σ per watch_history row on that channel:
//     3 if watched_on ≥ today−7, 2 if ≥ today−30, else 1
//   affinity_score = affinity (0 when the channel was never watched)
//   flat_score =
//     + 8 if in-progress-not-completed   ("continue watching")
//     + 5 if the channel has any 'like'
//     + 4 if the video itself is 'liked'
//     − 20 if the channel has a 'dislike'
//   disliked videos are excluded entirely.
// Depth blend — rn is the row's position under the plain
// affinity+flat ranking; popularity = 0.5^((rn−1)/60) halves every
// ~60 rows, so personalization cedes to discovery within the first
// couple of pages and deeper pages are mostly other channels'
// videos. Raw affinity is unbounded (a hyper-watched channel would
// outscore discovery forever), so it first squashes into a bounded
// 0–40 scale: weight = 40·a/(a+15). The slack is filled by a
// discovery score that favors low-affinity channels (+10 at
// affinity 0, fading to 0 by affinity 10), fresh uploads, and
// small catalogs (+10/√channel_size — a channel with only a few
// whitelisted videos outranks a backfilled giant at depth), minus
// a per-channel round-robin penalty (−3·ln(1 + position within own
// channel)) so the biggest catalog can't flood the tail — deep
// pages interleave every channel's videos evenly. The crossfade is
// per-row and exponential, so less-favored channels mix in
// gradually, and the more a channel is watched the deeper its
// videos persist before discovery takes over:
//   order = weight(affinity_score)·popularity + flat_score
//           + discovery·(1 − popularity)
// Postgres allows window functions in ORDER BY, so rn and the
// within-channel position live in the same ORDER BY — one stable
// ordering means offset paging can't duplicate or skip rows between
// pages.
// No history → all affinities 0 → ordering collapses to newest-first,
// so the tab still works on day one. Same { video, progress, reaction }
// row shape as getKidsVideos; inner-joins whitelisted_videos so unpin
// hides and re-pin returns. sort/dir/channel/list/date are ignored —
// the ranking IS the sort; q filters titles and `type` applies the
// ?type= shorts/videos filter (the Shorts feed is this query with
// type "shorts"). Pages of `limit`
// rows at `offset` — the grid's sentinel fetches deeper pages via the
// loadMoreForYou action. Ranking leans on current_date (recency tiers
// + md5 shuffle), so never wrap this in unstable_cache/"use cache" —
// that would freeze the daily re-rank.
export async function getRecommendedVideos(
  profileId: string,
  {
    q,
    limit = 60,
    offset = 0,
    type = "all",
    minLen,
    maxLen,
  }: {
    q?: string;
    limit?: number;
    offset?: number;
    type?: KidsType;
    minLen?: number | null;
    maxLen?: number | null;
  } = {}
) {
  // Per-channel watch recency/frequency — the dominant signal.
  const channelAffinity = db.$with("channel_affinity").as(
    db
      .select({
        channelId: videos.channelId,
        affinity: sql<number>`sum(case
          when ${watchHistory.watchedOn} >= current_date - 7 then 3
          when ${watchHistory.watchedOn} >= current_date - 30 then 2
          else 1 end)`.as("affinity"),
      })
      .from(watchHistory)
      .innerJoin(videos, eq(videos.id, watchHistory.videoId))
      .where(
        and(
          eq(watchHistory.profileId, profileId),
          isNotNull(videos.channelId)
        )
      )
      .groupBy(videos.channelId)
  );

  // Per-channel like/dislike flags — reactions live on videos, so roll
  // them up to the channel they were published on.
  const channelFlags = db.$with("channel_flags").as(
    db
      .select({
        channelId: videos.channelId,
        hasLike:
          sql<boolean>`bool_or(${videoReactions.reaction} = 'like')`.as(
            "has_like"
          ),
        hasDislike:
          sql<boolean>`bool_or(${videoReactions.reaction} = 'dislike')`.as(
            "has_dislike"
          ),
      })
      .from(videoReactions)
      .innerJoin(videos, eq(videos.id, videoReactions.videoId))
      .where(
        and(
          eq(videoReactions.profileId, profileId),
          isNotNull(videos.channelId)
        )
      )
      .groupBy(videos.channelId)
  );

  // Started, not finished, not within the tail of the video.
  const inProgress = sql`${watchProgress.positionSeconds} > 0
    and not coalesce(${watchProgress.completed}, false)
    and (${videos.durationSeconds} is null
         or ${watchProgress.positionSeconds} < ${videos.durationSeconds})`;

  // Popularity signal — the part that fades with scroll depth.
  // (Completed rows are filtered out below, so no 0.25 rewatch
  // discount is needed here.)
  const affinityScore = sql<number>`
    coalesce(${channelAffinity.affinity}, 0)`;
  // Explicit kid signals — apply at every depth.
  const flatScore = sql<number>`
    case when ${inProgress} then 8 else 0 end
    + case when ${channelFlags.hasLike} then 5 else 0 end
    + case when ${videoReactions.reaction} = 'like' then 4 else 0 end
    - case when ${channelFlags.hasDislike} then 20 else 0 end`;

  // Position under the plain personalized ranking — the depth dial.
  const rank = sql`row_number() over (
    order by ${affinityScore} + ${flatScore} desc,
             ${videos.publishedAt} desc nulls last,
             md5(${videos.id} || current_date))`;
  const popularity = sql`power(0.5, (${rank} - 1) / 60.0)`;
  // Squash affinity into a bounded 0–40 scale so one hyper-watched
  // channel can't outscore discovery at any depth.
  const affinityWeight = sql`
    40.0 * ${affinityScore} / (${affinityScore} + 15.0)`;
  // The video's position inside its own channel (newest first) — the
  // round-robin dial that spreads one channel's catalog across the
  // tail instead of letting it flood consecutive pages.
  const withinChannel = sql`row_number() over (
    partition by ${videos.channelId}
    order by ${videos.publishedAt} desc nulls last,
             md5(${videos.id} || current_date))`;
  // Channel's catalog size inside this feed — small catalogs get a
  // discovery bonus so a handful of pins on a channel surfaces before
  // the deep tail of a backfilled giant.
  const channelSize = sql`count(*) over (partition by ${videos.channelId})`;
  const discovery = sql`
    10 - least(10, coalesce(${channelAffinity.affinity}, 0))
    + case
        when ${videos.publishedAt} >= current_date - 30 then 4
        when ${videos.publishedAt} >= current_date - 90 then 2
        else 0 end
    + 10.0 / sqrt(${channelSize})
    - 3.0 * ln(1 + ${withinChannel})`;

  return db
    .with(channelAffinity, channelFlags)
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
    .leftJoin(
      channelAffinity,
      eq(channelAffinity.channelId, videos.channelId)
    )
    .leftJoin(channelFlags, eq(channelFlags.channelId, videos.channelId))
    .where(
      and(
        eq(whitelistedVideos.profileId, profileId),
        suitableVideo,
        // Finished videos never surface — recommendations are only
        // what the kid hasn't entirely watched yet (in-progress ok).
        sql`not coalesce(${watchProgress.completed}, false)`,
        // Disliked videos drop out of the tab entirely.
        sql`${videoReactions.reaction} is distinct from 'dislike'`,
        typeFilter(type),
        lenFilter(minLen, maxLen),
        q ? ilike(videos.title, `%${q}%`) : undefined
      )
    )
    // Same-score ties: newest first; rows still tied (e.g. null
    // published_at) rotate daily via the md5 seed instead of a random
    // order that reshuffles on every refresh.
    .orderBy(
      sql`${affinityWeight} * ${popularity}
          + ${flatScore}
          + ${discovery} * (1 - ${popularity}) desc`,
      sql`${videos.publishedAt} desc nulls last`,
      sql`md5(${videos.id} || current_date)`
    )
    .limit(limit)
    .offset(offset);
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
// Under a ?type=/?max= filter the count covers only matching videos
// and channels with none drop out — "which channels have shorts?".
export async function getKidsChannels(
  profileId: string,
  {
    q,
    type = "all",
    minLen,
    maxLen,
  }: {
    q?: string;
    type?: KidsType;
    minLen?: number | null;
    maxLen?: number | null;
  } = {}
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
        suitableVideo,
        typeFilter(type),
        lenFilter(minLen, maxLen),
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
    // Filtered feeds list only channels that actually have matching
    // videos — a 0-count tile would link to an empty drill-in.
    if (!existing && (type !== "all" || minLen != null || maxLen != null))
      continue;
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
  // Last item add, or creation time for empty playlists — orders the
  // ⋮ menu's "recent playlists" quick-add list.
  updatedAt: Date;
}

// Playlists for a profile with their VISIBLE item count (items whose video
// is currently unpinned don't count) and a cover taken from the first
// visible item — same unpin-hides semantics as getPlaylistVideos.
// cache() shares one query per request across separate Suspense
// boundaries (the home shelves and the view's own grid/menu snapshot).
export const getPlaylists = cache(async function getPlaylists(
  profileId: string
): Promise<KidsPlaylist[]> {
  return db
    .select({
      id: playlists.id,
      name: playlists.name,
      // videos.id (not whitelistedVideos.videoId) so items hidden by the
      // 18+ floor — join condition below — don't count.
      videoCount: count(videos.id),
      coverThumbnail: sql<string | null>`(
        array_agg(${videos.thumbnail} order by ${playlistItems.position} asc)
        filter (where ${videos.thumbnail} is not null)
      )[1]`,
      updatedAt: sql<Date>`coalesce(
        max(${playlistItems.addedAt}), ${playlists.createdAt}
      )`,
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
    .leftJoin(
      videos,
      and(eq(videos.id, whitelistedVideos.videoId), suitableVideo)
    )
    .where(eq(playlists.profileId, profileId))
    .groupBy(playlists.id, playlists.name, playlists.createdAt)
    .orderBy(asc(playlists.createdAt));
});

// One playlist's videos in kid-defined order. Same { video, progress,
// reaction } row shape as getKidsVideos. Rows inner-join
// whitelisted_videos on the playlist's profile, so an unpinned video hides
// (and returns at its old position on re-pin) and a playlist belonging to
// another profile returns nothing.
export async function getPlaylistVideos(
  profileId: string,
  playlistId: string,
  {
    q,
    type,
    minLen,
    maxLen,
  }: {
    q?: string;
    type?: KidsType;
    minLen?: number | null;
    maxLen?: number | null;
  } = {}
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
        suitableVideo,
        typeFilter(type),
        lenFilter(minLen, maxLen),
        q ? ilike(videos.title, `%${q}%`) : undefined
      )
    )
    // addedAt breaks same-position ties (concurrent adds racing on
    // max(position)+1) so the kid-visible order is deterministic.
    .orderBy(asc(playlistItems.position), asc(playlistItems.addedAt));
}
