import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/lib/db";
import { songs, videos } from "@/lib/db/schema";

export type SongsView = "songs" | "compilations" | "mine";
export type SongsSort = "recent" | "title" | "length";
export type SongsDir = "asc" | "desc";

export interface SongsFeedParams {
  // "mine" is signed-in only — parseSongsFeedParams coerces it to
  // "songs" for anonymous visitors so the URL never 404s.
  view: SongsView;
  // Drill-in: one compilation's songs — only meaningful on "songs".
  video: string | null;
  sort: SongsSort;
  dir: SongsDir;
  q: string;
}

// YouTube video ids are [A-Za-z0-9_-] — same charset kids-feed allows
// for channel ids.
const VIDEO_ID_RE = /^[\w-]+$/;

// A bare ?sort= picks the natural direction for that key: newest-first
// for recency, A-Z and shortest-first for the alphabetical/length keys.
const defaultDir = (sort: SongsSort): SongsDir =>
  sort === "recent" ? "desc" : "asc";

// Validates raw searchParams; bad values fall back to defaults.
export function parseSongsFeedParams(
  raw: Record<string, string | string[] | undefined>,
  signedIn: boolean
): SongsFeedParams {
  const first = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v) ?? "";
  const rawView = first(raw.view);
  const view: SongsView =
    rawView === "compilations"
      ? "compilations"
      : rawView === "mine" && signedIn
        ? "mine"
        : "songs";
  const rawVideo = first(raw.video);
  const video =
    view === "songs" && VIDEO_ID_RE.test(rawVideo) ? rawVideo : null;
  const rawSort = first(raw.sort);
  const sort: SongsSort =
    rawSort === "title" || rawSort === "length" ? rawSort : "recent";
  const rawDir = first(raw.dir);
  const dir: SongsDir =
    rawDir === "asc" || rawDir === "desc" ? rawDir : defaultDir(sort);
  return { view, video, sort, dir, q: first(raw.q) };
}

// Query string (with leading "?", or "") carrying every non-default param.
export function songsFeedQuery(
  params: SongsFeedParams,
  overrides: Partial<SongsFeedParams> = {}
): string {
  const next = { ...params, ...overrides };
  const sp = new URLSearchParams();
  if (next.view !== "songs") sp.set("view", next.view);
  if (next.view === "songs" && next.video) sp.set("video", next.video);
  if (next.sort !== "recent") sp.set("sort", next.sort);
  if (next.dir !== defaultDir(next.sort)) sp.set("dir", next.dir);
  if (next.q) sp.set("q", next.q);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

// Catalog path for a feed — the single helper so tabs, sorts, search
// and drill-ins never drop each other's params.
export function songsCatalogUrl(
  feed: SongsFeedParams,
  overrides: Partial<SongsFeedParams> = {}
): string {
  return `/songs${songsFeedQuery(feed, overrides)}`;
}

export interface FeedSong {
  id: string; // songs.id — key + the future ?song=<uuid> watch param
  title: string;
  startSeconds: number;
  endSeconds: number | null; // null = "plays to the end of the video"
  videoId: string;
  videoTitle: string; // the compilation it came from
  videoDuration: number | null; // fills the range badge's open end
  thumbnail: string; // compilation thumbnail
  channelTitle: string;
  // Owner-only ⋮ delete menu, stamped server-side — rows serialize to
  // the public route's client components, so the raw importedBy user
  // id never ships; deleteSong re-verifies ownership regardless.
  canDelete: boolean;
}

// The raw select row: FeedSong's fields plus the importer's user id,
// which feeds the "Yours" filter and the canDelete stamp in
// toFeedSong. Server-side only — it must not reach client props.
type SongRow = Omit<FeedSong, "canDelete"> & {
  importedBy: string | null;
};

// Only the columns the card and the range badge render — the full
// videos row carries description/tags/raw JSONB (~9KB/row). sourceHandle
// isn't rendered anywhere and stays unselected.
const feedSongCols = {
  id: songs.id,
  title: songs.title,
  startSeconds: songs.startSeconds,
  endSeconds: songs.endSeconds,
  videoId: songs.videoId,
  videoTitle: videos.title,
  videoDuration: videos.durationSeconds,
  thumbnail: videos.thumbnail,
  channelTitle: videos.channelTitle,
  importedBy: songs.importedBy,
};

// Row → client-facing FeedSong: resolves canDelete against the session
// user and lists the outgoing columns explicitly so importedBy (and
// any future sensitive column) can't leak into serialized props.
function toFeedSong(row: SongRow, viewerId?: string): FeedSong {
  return {
    id: row.id,
    title: row.title,
    startSeconds: row.startSeconds,
    endSeconds: row.endSeconds,
    videoId: row.videoId,
    videoTitle: row.videoTitle,
    videoDuration: row.videoDuration,
    thumbnail: row.thumbnail,
    channelTitle: row.channelTitle,
    canDelete: viewerId != null && row.importedBy === viewerId,
  };
}

// Song length = end - start; an open end borrows the compilation's
// duration. Null when the video's duration is also unknown — those
// rows sort last on the length sort.
const songLength = sql<number | null>`coalesce(${songs.endSeconds}, ${videos.durationSeconds}) - ${songs.startSeconds}`;

// Songs from a 5h stream can run 50+ and the registry only grows;
// the grid windows client-side, so this cap is about payload, not
// page size. Cursor pagination is a documented seam.
const SONGS_LIMIT = 240;

// The catalog grid: all imported songs joined to their compilation
// video, optionally filtered to one compilation (?video=), one
// importer (view=mine) or a title search (q matches song OR
// compilation title), ordered per sort/dir.
export async function getSongs(
  feed: SongsFeedParams,
  importedByUserId?: string
): Promise<FeedSong[]> {
  const orderBy =
    feed.sort === "title"
      ? [
          feed.dir === "asc" ? asc(songs.title) : desc(songs.title),
          asc(songs.startSeconds),
        ]
      : feed.sort === "length"
        ? [
            feed.dir === "asc"
              ? sql`${songLength} asc nulls last`
              : sql`${songLength} desc nulls last`,
            asc(songs.startSeconds),
          ]
        : [
            feed.dir === "asc"
              ? asc(songs.createdAt)
              : desc(songs.createdAt),
            asc(songs.startSeconds),
          ];

  const rows = await db
    .select(feedSongCols)
    .from(songs)
    .innerJoin(videos, eq(videos.id, songs.videoId))
    .where(
      and(
        feed.video ? eq(songs.videoId, feed.video) : undefined,
        // "mine" fails closed: a missing session id filters to zero
        // rows instead of dropping the predicate and listing
        // everyone's songs. The nil uuid keeps it a valid literal so
        // Postgres returns an empty set rather than erroring.
        feed.view === "mine"
          ? eq(
              songs.importedBy,
              importedByUserId ?? "00000000-0000-0000-0000-000000000000"
            )
          : undefined,
        feed.q
          ? or(
              ilike(songs.title, `%${feed.q}%`),
              ilike(videos.title, `%${feed.q}%`)
            )
          : undefined
      )
    )
    .orderBy(...orderBy)
    .limit(SONGS_LIMIT);

  return rows.map((row) => toFeedSong(row, importedByUserId));
}

export interface FeedCompilation {
  id: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  songCount: number;
}

// One tile per compilation video that has at least one imported song.
export async function getCompilations({
  q,
}: { q?: string } = {}): Promise<FeedCompilation[]> {
  return db
    .select({
      id: videos.id,
      title: videos.title,
      thumbnail: videos.thumbnail,
      channelTitle: videos.channelTitle,
      songCount: count(songs.id),
    })
    .from(songs)
    .innerJoin(videos, eq(videos.id, songs.videoId))
    .where(q ? ilike(videos.title, `%${q}%`) : undefined)
    .groupBy(
      videos.id,
      videos.title,
      videos.thumbnail,
      videos.channelTitle
    )
    .orderBy(asc(videos.title));
}

// Newest imports across all parents — the "Newly added" home shelf.
export async function getNewSongs(
  limit = 12,
  viewerId?: string
): Promise<FeedSong[]> {
  const rows = await db
    .select(feedSongCols)
    .from(songs)
    .innerJoin(videos, eq(videos.id, songs.videoId))
    .orderBy(desc(songs.createdAt))
    .limit(limit);
  return rows.map((row) => toFeedSong(row, viewerId));
}

// One parent's imports, newest first — the "Your imports" home shelf.
export async function getUserSongs(
  userId: string,
  limit = 12
): Promise<FeedSong[]> {
  const rows = await db
    .select(feedSongCols)
    .from(songs)
    .innerJoin(videos, eq(videos.id, songs.videoId))
    .where(eq(songs.importedBy, userId))
    .orderBy(desc(songs.createdAt))
    .limit(limit);
  return rows.map((row) => toFeedSong(row, userId));
}
