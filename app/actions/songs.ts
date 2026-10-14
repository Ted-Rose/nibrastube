"use server";

import { and, eq, notInArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { songs, users, videos } from "@/lib/db/schema";
import { getSession, requireParentUnlocked } from "@/lib/auth";
import {
  getVideoDetails,
  listVideoComments,
  parseYouTubeVideoId,
  resolveChannelHandle,
  videoRowValues,
  type FullVideoDetails,
  type VideoComment,
} from "@/lib/youtube";
import {
  normalizeHandle,
  parseTracklist,
  type ParsedSong,
} from "@/lib/song-timestamps";
import axios from "axios";

export interface SongImportVideo {
  id: string;
  title: string;
  thumbnail: string;
  durationSeconds: number | null;
}

export type SongImportState =
  | {
      video: SongImportVideo;
      handle: string;
      songs: ParsedSong[];
      sourceCommentId: string;
    }
  | { error: string }
  | null;

const previewSchema = z.object({
  url: z.string(),
  handle: z.string(),
});

const importSchema = z.object({
  videoId: z.string(),
  handle: z.string(),
  returnTo: z.string().optional(),
});

// Cached row when fresh (fetchedAt set), otherwise the API — `persist`
// mirrors pinVideo's self-heal: preview only reads, import writes.
async function getOrFetchVideo(
  videoId: string,
  persist: boolean
): Promise<SongImportVideo | null> {
  const existing = await db.query.videos.findFirst({
    where: eq(videos.id, videoId),
  });

  if (existing?.fetchedAt) {
    return {
      id: existing.id,
      title: existing.title,
      thumbnail: existing.thumbnail,
      durationSeconds: existing.durationSeconds,
    };
  }

  let details: FullVideoDetails;
  try {
    details = await getVideoDetails(videoId);
  } catch {
    return null;
  }
  if (!details) return null;

  if (persist) {
    if (!existing) {
      await db.insert(videos).values(videoRowValues(details));
    } else {
      const { id, ...updates } = videoRowValues(details);
      await db.update(videos).set(updates).where(eq(videos.id, id));
    }
  }

  return {
    id: details.id,
    title: details.title,
    thumbnail: details.thumbnail,
    durationSeconds: details.durationSeconds,
  };
}

type PipelineResult =
  | {
      video: SongImportVideo;
      songs: ParsedSong[];
      sourceCommentId: string;
    }
  | { error: string };

// Shared preview/import pipeline: video details (for duration + title)
// → handle → comments → author's tracklists → the longest parse.
async function runSongImport(
  videoId: string,
  handle: string,
  persist: boolean
): Promise<PipelineResult> {
  const details = await getOrFetchVideo(videoId, persist);
  if (!details) {
    return { error: "Couldn't load that video (removed or private?)." };
  }

  const channelId = await resolveChannelHandle(handle);
  if (!channelId) {
    return {
      error: `No YouTube channel for @${handle} — check the spelling.`,
    };
  }

  let comments: VideoComment[];
  try {
    comments = await listVideoComments(videoId);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      return {
        error:
          "Couldn't load comments for that video (disabled or removed?).",
      };
    }
    throw err;
  }

  const authorComments = comments.filter(
    (c) =>
      c.authorChannelId === channelId ||
      // Fallback for comments that predate channel IDs surfacing.
      c.authorDisplayName.toLowerCase() === `@${handle}`
  );
  if (authorComments.length === 0) {
    return {
      error: `No comments by @${handle} on that video (scanned ${comments.length} comments).`,
    };
  }

  // The comment with the most parsed lines wins; ties go to the
  // earliest so an edited repost doesn't beat the original.
  let best: { comment: VideoComment; songs: ParsedSong[] } | null = null;
  for (const comment of authorComments) {
    const parsed = parseTracklist(comment.text, details.durationSeconds);
    if (parsed.length === 0) continue;
    if (
      !best ||
      parsed.length > best.songs.length ||
      (parsed.length === best.songs.length &&
        (comment.publishedAt ?? "") < (best.comment.publishedAt ?? ""))
    ) {
      best = { comment, songs: parsed };
    }
  }

  if (!best) {
    return {
      error: `Found ${authorComments.length} comment${authorComments.length === 1 ? "" : "s"} by @${handle} but no timestamped tracklist.`,
    };
  }

  return {
    video: {
      id: details.id,
      title: details.title,
      thumbnail: details.thumbnail,
      durationSeconds: details.durationSeconds,
    },
    songs: best.songs,
    sourceCommentId: best.comment.id,
  };
}

// Dry run behind the "Find songs" button: parses everything but writes
// nothing, so a wrong handle or drifting comment format can't write
// garbage. Costs ~3-8 YouTube quota units.
export async function previewSongImport(
  _prevState: SongImportState,
  formData: FormData
): Promise<SongImportState> {
  const session = await getSession();
  if (!session) return { error: "Not signed in." };
  await requireParentUnlocked();

  const parsed = previewSchema.safeParse({
    url: formData.get("url"),
    handle: formData.get("handle"),
  });
  if (!parsed.success) return { error: "Enter a YouTube link." };

  const handle = normalizeHandle(parsed.data.handle);
  if (!handle) return { error: "Enter the commenter's YouTube handle." };

  const videoId = parseYouTubeVideoId(parsed.data.url);
  if (!videoId) {
    return { error: "That's not a YouTube link I recognize." };
  }

  const result = await runSongImport(videoId, handle, false);
  if ("error" in result) return result;
  return { ...result, handle };
}

// Confirm: reruns the same pipeline deterministically, persists the
// handle on the user row (it doubles as the setting for next time),
// writes the videos row if still missing, then replaces this comment's
// stale rows and upserts the new set — an edited comment cleanly
// replaces its own output without clobbering another commenter's rows.
export async function importSongs(
  _prevState: SongImportState,
  formData: FormData
): Promise<SongImportState> {
  const session = await getSession();
  if (!session) return { error: "Not signed in." };
  await requireParentUnlocked();

  const parsed = importSchema.safeParse({
    videoId: formData.get("videoId"),
    handle: formData.get("handle"),
    returnTo: formData.get("returnTo") ?? undefined,
  });
  if (!parsed.success) return { error: "Missing import details." };

  const handle = normalizeHandle(parsed.data.handle);
  const videoId = parseYouTubeVideoId(parsed.data.videoId);
  if (!handle || !videoId) {
    return { error: "Missing import details." };
  }

  const result = await runSongImport(videoId, handle, true);
  if ("error" in result) return result;

  await db
    .update(users)
    .set({ songCommenterHandle: handle })
    .where(eq(users.id, session.user.id));

  const newStarts = result.songs.map((s) => s.startSeconds);
  await db
    .delete(songs)
    .where(
      and(
        eq(songs.videoId, videoId),
        eq(songs.sourceCommentId, result.sourceCommentId),
        notInArray(songs.startSeconds, newStarts)
      )
    );

  await db
    .insert(songs)
    .values(
      result.songs.map((s) => ({
        videoId,
        title: s.title,
        startSeconds: s.startSeconds,
        endSeconds: s.endSeconds,
        sourceCommentId: result.sourceCommentId,
        sourceHandle: handle,
        importedBy: session.user.id,
      }))
    )
    .onConflictDoUpdate({
      target: [songs.videoId, songs.startSeconds],
      set: {
        title: sql`excluded.title`,
        endSeconds: sql`excluded.end_seconds`,
        sourceCommentId: sql`excluded.source_comment_id`,
        sourceHandle: sql`excluded.source_handle`,
        importedBy: sql`excluded.imported_by`,
      },
    });

  // Same returnTo convention as refreshStaleVideos: keep the
  // dashboard's profileId/q/type params, tag the imported video.
  const returnTo = parsed.data.returnTo;
  const base =
    returnTo && returnTo.startsWith("/parent/dashboard")
      ? returnTo
      : "/parent/dashboard";
  const sep = base.includes("?") ? "&" : "?";
  redirect(`${base}${sep}songsVideo=${videoId}`);
}
