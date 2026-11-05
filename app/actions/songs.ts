"use server";

import { and, eq, notInArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { songs, users, videos } from "@/lib/db/schema";
import {
  getSession,
  parentSession,
  requireParentUnlocked,
} from "@/lib/auth";
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
  parseChapters,
  parseTracklist,
  type ParsedSong,
} from "@/lib/song-timestamps";
import axios from "axios";

export interface SongImportVideo {
  id: string;
  title: string;
  thumbnail: string;
  durationSeconds: number | null;
  // The uploader's description text — the chapters fallback parses
  // it when the comment path yields no tracklist.
  description: string | null;
}

export type SongImportState =
  | {
      // Serialized to the client, so `description` is deliberately
      // dropped — the card renders only id/title/thumbnail and the
      // uploader's full text is several KB.
      video: Omit<SongImportVideo, "description">;
      // The handle whose comment produced the tracklist; null on a
      // description-chapters import.
      handle: string | null;
      songs: ParsedSong[];
      sourceCommentId: string;
      source: "comment" | "description";
    }
  | { error: string }
  | null;

export type HandleSaveState = { saved: string } | { error: string } | null;

const previewSchema = z.object({
  url: z.string(),
});

const importSchema = z.object({
  videoId: z.string(),
  returnTo: z.string().optional(),
});

const deleteSchema = z.object({
  songId: z.uuid(),
});


// The commenter handle is a stored preference — it never round-trips
// through the client as a form field.
async function getSongCommenterHandle(userId: string): Promise<string | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { songCommenterHandle: true },
  });
  return user?.songCommenterHandle ?? null;
}

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
    // Unvetted-surface gates: the 13+ made-for-kids flag and the 18+
    // hard floor both refuse — a song imported from a restricted
    // video would be invisible to every /songs query forever.
    if (existing.madeForKids === true || existing.ageRestricted === true) {
      return null;
    }
    return {
      id: existing.id,
      title: existing.title,
      thumbnail: existing.thumbnail,
      durationSeconds: existing.durationSeconds,
      description: existing.description,
    };
  }

  let details: FullVideoDetails;
  try {
    details = await getVideoDetails(videoId);
  } catch {
    return null;
  }
  if (
    !details ||
    details.madeForKids === true ||
    details.ageRestricted === true
  ) {
    return null;
  }

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
    description: details.description,
  };
}

type PipelineResult =
  | {
      video: SongImportVideo;
      songs: ParsedSong[];
      // YT comment id, or the "description" sentinel on chapter
      // imports — importSongs' stale-row delete keys on it either way.
      sourceCommentId: string;
      // The commenter handle on comment imports; null on chapter
      // imports (the text is the uploader's own description).
      sourceHandle: string | null;
      source: "comment" | "description";
    }
  | { error: string };

// Shared preview/import pipeline: video details (for duration +
// title + description) → stored handle → comments → author's
// tracklists → the longest parse. A stored handle's tracklist is
// authoritative; when the comment path yields zero songs — no saved
// handle, no comment by the handle, or none of their comments parse —
// the fallback parses the video's own description chapters, which the
// videos.list call already fetched (zero extra quota). Config and
// fetch failures (unresolvable handle, comments API error) still
// short-circuit — they're not a per-video "no songs" outcome.
async function runSongImport(
  videoId: string,
  handle: string | null,
  persist: boolean
): Promise<PipelineResult> {
  const details = await getOrFetchVideo(videoId, persist);
  if (!details) {
    return { error: "Couldn't load that video (removed or private?)." };
  }

  // Why the comment path found nothing — folds into the error when
  // the chapters fallback also misses.
  let commentMiss = "no song commenter handle saved";

  if (handle) {
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
      commentMiss = `no comments by @${handle} (scanned ${comments.length})`;
    } else {
      // The comment with the most parsed lines wins; ties go to the
      // earliest so an edited repost doesn't beat the original.
      let best: { comment: VideoComment; songs: ParsedSong[] } | null =
        null;
      for (const comment of authorComments) {
        const parsed = parseTracklist(
          comment.text,
          details.durationSeconds
        );
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
      if (best) {
        return {
          video: details,
          songs: best.songs,
          sourceCommentId: best.comment.id,
          sourceHandle: handle,
          source: "comment",
        };
      }
      commentMiss = `no timestamped tracklist in @${handle}'s comments`;
    }
  }

  // Fallback: the uploader's own description chapters.
  const chapters = parseChapters(
    details.description ?? "",
    details.durationSeconds
  );
  if (chapters.length === 0) {
    return {
      error:
        `No songs found — ${commentMiss}, ` +
        "and no chapters in the video description.",
    };
  }

  return {
    video: details,
    songs: chapters,
    sourceCommentId: "description",
    sourceHandle: null,
    source: "description",
  };
}

// Saves the commenter-handle preference. Verifies the handle resolves
// to a real YouTube channel before storing (1 quota unit), so a typo
// fails here with a friendly message instead of at import time.
export async function saveSongCommenterHandle(
  _prevState: HandleSaveState,
  formData: FormData
): Promise<HandleSaveState> {
  const user = parentSession(await getSession());
  if (!user) return { error: "Not signed in." };
  await requireParentUnlocked();

  const parsed = z.object({ handle: z.string() }).safeParse({
    handle: formData.get("handle"),
  });
  if (!parsed.success) return { error: "Enter a YouTube handle." };

  const handle = normalizeHandle(parsed.data.handle);
  if (!handle) {
    return { error: "Enter a YouTube handle like @song-commenter." };
  }

  const channelId = await resolveChannelHandle(handle);
  if (!channelId) {
    return {
      error: `No YouTube channel for @${handle} — check the spelling.`,
    };
  }

  await db
    .update(users)
    .set({ songCommenterHandle: handle })
    .where(eq(users.id, user.id));

  // Fresh storedHandle prop for the card on the same round-trip.
  revalidatePath("/parent/dashboard");

  return { saved: handle };
}

// Dry run behind the "Find songs" button: parses everything but writes
// nothing, so a drifting comment format can't write garbage. Uses the
// stored commenter handle when there is one; without it the pipeline
// goes straight to the description-chapters fallback. Costs ~3-8
// YouTube quota units on the comment path, ~1 on chapters only.
export async function previewSongImport(
  _prevState: SongImportState,
  formData: FormData
): Promise<SongImportState> {
  const user = parentSession(await getSession());
  if (!user) return { error: "Not signed in." };
  await requireParentUnlocked();

  const parsed = previewSchema.safeParse({
    url: formData.get("url"),
  });
  if (!parsed.success) return { error: "Enter a YouTube link." };

  const handle = await getSongCommenterHandle(user.id);

  const videoId = parseYouTubeVideoId(parsed.data.url);
  if (!videoId) {
    return { error: "That's not a YouTube link I recognize." };
  }

  const result = await runSongImport(videoId, handle, false);
  if ("error" in result) return result;
  // Shape explicitly — spreading PipelineResult would also ship
  // sourceHandle and the multi-KB video.description to the client.
  const { id, title, thumbnail, durationSeconds } = result.video;
  return {
    video: { id, title, thumbnail, durationSeconds },
    handle: result.sourceHandle,
    songs: result.songs,
    sourceCommentId: result.sourceCommentId,
    source: result.source,
  };
}

// Confirm: reruns the same pipeline deterministically against the
// stored handle (or straight to chapters when none is saved), writes
// the videos row if still missing, then replaces the source's stale
// rows and upserts the new set — keyed on (videoId, sourceCommentId),
// where the "description" sentinel gives chapter imports the same
// replace-own-output semantics an edited comment gets without
// clobbering another source's rows.
export async function importSongs(
  _prevState: SongImportState,
  formData: FormData
): Promise<SongImportState> {
  const user = parentSession(await getSession());
  if (!user) return { error: "Not signed in." };
  await requireParentUnlocked();

  const parsed = importSchema.safeParse({
    videoId: formData.get("videoId"),
    returnTo: formData.get("returnTo") ?? undefined,
  });
  if (!parsed.success) return { error: "Missing import details." };

  const handle = await getSongCommenterHandle(user.id);
  const videoId = parseYouTubeVideoId(parsed.data.videoId);
  if (!videoId) {
    return { error: "Missing import details." };
  }

  const result = await runSongImport(videoId, handle, true);
  if ("error" in result) return result;

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
        sourceHandle: result.sourceHandle,
        // Comment imports never carry the flag (parseTracklist leaves
        // it unset); chapter imports flag the sermon cut onward.
        mightNotBeSong: s.mightNotBeSong ?? false,
        importedBy: user.id,
      }))
    )
    .onConflictDoUpdate({
      target: [songs.videoId, songs.startSeconds],
      set: {
        title: sql`excluded.title`,
        endSeconds: sql`excluded.end_seconds`,
        sourceCommentId: sql`excluded.source_comment_id`,
        sourceHandle: sql`excluded.source_handle`,
        mightNotBeSong: sql`excluded.might_not_be_song`,
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

// Owner-only delete from the public catalog (or a dashboard list
// later). Songs are global rows — deleting one affects every viewer —
// so it's gated like a parent mutation AND on
// songs.importedBy === session.user.id. Rows whose importing account
// was deleted have importedBy null: unowned, they simply can't be
// deleted through the UI (admin cleanup is manual).
export async function deleteSong(songId: string) {
  const user = parentSession(await getSession());
  if (!user) return { error: "Not signed in." };
  await requireParentUnlocked();

  const parsed = deleteSchema.safeParse({ songId });
  if (!parsed.success) return { error: "Missing song id." };

  const song = await db.query.songs.findFirst({
    where: eq(songs.id, parsed.data.songId),
  });
  // One message whether the row is missing or someone else's — the
  // caller learns nothing about song ids it doesn't own.
  if (!song || song.importedBy !== user.id) {
    return { error: "Couldn't delete that song." };
  }

  await db.delete(songs).where(eq(songs.id, song.id));
  revalidatePath("/songs");
  return { deleted: true };
}
