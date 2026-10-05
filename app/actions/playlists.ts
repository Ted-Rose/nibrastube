"use server";

import { and, count, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  playlistItems,
  playlists,
  whitelistedVideos,
} from "@/lib/db/schema";
import { assertCanEditKidData } from "@/lib/profiles";

const MAX_PLAYLISTS = 50;
const MAX_ITEMS = 500;

const nameSchema = z.string().trim().min(1).max(60);
const playlistIdSchema = z.string().uuid();
const videoIdSchema = z.string().min(1);

// Kid-scope auth (kid-locked device OR managing parent session) happens in
// assertCanEditKidData — never requireParentUnlocked, so a locked kid
// device can manage its own playlists.
async function getOwnedPlaylist(profileId: string, playlistId: string) {
  const playlist = await db.query.playlists.findFirst({
    where: eq(playlists.id, playlistId),
  });
  if (!playlist || playlist.profileId !== profileId) {
    throw new Error("Playlist not found");
  }
  return playlist;
}

async function notifyPlaylistChanged(profileId: string) {
  const { pusherServer } = await import("@/lib/pusher");
  await pusherServer.trigger(`profile-${profileId}`, "playlist-changed", {});
  revalidatePath(`/kids/${profileId}`);
}

// Playlist ids already containing a video — feeds the save dialog's check
// state. Read-only, but same kid-scope auth as the mutations.
export async function getVideoPlaylistIds(profileId: string, videoId: string) {
  await assertCanEditKidData(profileId);
  const parsed = videoIdSchema.safeParse(videoId);
  if (!parsed.success) throw new Error("Invalid video");

  const rows = await db
    .select({ playlistId: playlistItems.playlistId })
    .from(playlistItems)
    .innerJoin(playlists, eq(playlists.id, playlistItems.playlistId))
    .where(
      and(
        eq(playlists.profileId, profileId),
        eq(playlistItems.videoId, parsed.data)
      )
    );
  return rows.map((r) => r.playlistId);
}

export async function createPlaylist(profileId: string, name: string) {
  await assertCanEditKidData(profileId);
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) {
    throw new Error("Playlist name must be 1-60 characters");
  }

  const [{ total }] = await db
    .select({ total: count(playlists.id) })
    .from(playlists)
    .where(eq(playlists.profileId, profileId));
  if (total >= MAX_PLAYLISTS) {
    throw new Error(`No more than ${MAX_PLAYLISTS} playlists`);
  }

  const [playlist] = await db
    .insert(playlists)
    .values({ profileId, name: parsed.data })
    .returning({ id: playlists.id, name: playlists.name });

  await notifyPlaylistChanged(profileId);
  return playlist;
}

export async function renamePlaylist(
  profileId: string,
  playlistId: string,
  name: string
) {
  await assertCanEditKidData(profileId);
  if (!playlistIdSchema.safeParse(playlistId).success) {
    throw new Error("Invalid playlist");
  }
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) {
    throw new Error("Playlist name must be 1-60 characters");
  }
  const playlist = await getOwnedPlaylist(profileId, playlistId);

  await db
    .update(playlists)
    .set({ name: parsed.data })
    .where(eq(playlists.id, playlist.id));

  await notifyPlaylistChanged(profileId);
}

export async function deletePlaylist(profileId: string, playlistId: string) {
  await assertCanEditKidData(profileId);
  if (!playlistIdSchema.safeParse(playlistId).success) {
    throw new Error("Invalid playlist");
  }
  const playlist = await getOwnedPlaylist(profileId, playlistId);

  // playlist_items rows cascade with the playlist.
  await db.delete(playlists).where(eq(playlists.id, playlist.id));

  await notifyPlaylistChanged(profileId);
}

export async function addToPlaylist(
  profileId: string,
  playlistId: string,
  videoId: string
) {
  await assertCanEditKidData(profileId);
  if (
    !playlistIdSchema.safeParse(playlistId).success ||
    !videoIdSchema.safeParse(videoId).success
  ) {
    throw new Error("Invalid playlist or video");
  }
  const playlist = await getOwnedPlaylist(profileId, playlistId);

  // Whitelist is absolute — only currently-approved videos can be added.
  const approved = await db.query.whitelistedVideos.findFirst({
    where: and(
      eq(whitelistedVideos.profileId, profileId),
      eq(whitelistedVideos.videoId, videoId)
    ),
  });
  if (!approved) throw new Error("Video is not approved for this profile");

  const [{ total, maxPosition }] = await db
    .select({
      total: count(playlistItems.videoId),
      maxPosition: sql<number | null>`max(${playlistItems.position})`,
    })
    .from(playlistItems)
    .where(eq(playlistItems.playlistId, playlist.id));
  if (total >= MAX_ITEMS) {
    throw new Error(`No more than ${MAX_ITEMS} videos per playlist`);
  }

  // Repeat adds are a no-op on the (playlistId, videoId) PK.
  await db
    .insert(playlistItems)
    .values({
      playlistId: playlist.id,
      videoId,
      position: (maxPosition ?? -1) + 1,
    })
    .onConflictDoNothing();

  await notifyPlaylistChanged(profileId);
}

export async function removeFromPlaylist(
  profileId: string,
  playlistId: string,
  videoId: string
) {
  await assertCanEditKidData(profileId);
  if (
    !playlistIdSchema.safeParse(playlistId).success ||
    !videoIdSchema.safeParse(videoId).success
  ) {
    throw new Error("Invalid playlist or video");
  }
  const playlist = await getOwnedPlaylist(profileId, playlistId);

  // Removing leaves a position gap — harmless, ORDER BY position doesn't
  // care; setPlaylistOrder compacts again on the next reorder.
  await db
    .delete(playlistItems)
    .where(
      and(
        eq(playlistItems.playlistId, playlist.id),
        eq(playlistItems.videoId, videoId)
      )
    );

  await notifyPlaylistChanged(profileId);
}

// Full-order rewrite: the posted id list must equal the playlist's item
// set exactly, so a stale client can't silently drop or inject items.
export async function setPlaylistOrder(
  profileId: string,
  playlistId: string,
  videoIds: string[]
) {
  await assertCanEditKidData(profileId);
  if (!playlistIdSchema.safeParse(playlistId).success) {
    throw new Error("Invalid playlist");
  }
  const playlist = await getOwnedPlaylist(profileId, playlistId);

  const parsed = z
    .array(videoIdSchema)
    .max(MAX_ITEMS)
    .safeParse(videoIds);
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) {
    throw new Error("Invalid order");
  }
  const ids = parsed.data;

  const existing = await db
    .select({ videoId: playlistItems.videoId })
    .from(playlistItems)
    .where(eq(playlistItems.playlistId, playlist.id));
  const idSet = new Set(ids);
  if (
    existing.length !== ids.length ||
    existing.some((r) => !idSet.has(r.videoId))
  ) {
    throw new Error("Playlist changed — refresh and try again");
  }

  await db.transaction(async (tx) => {
    for (const [position, videoId] of ids.entries()) {
      await tx
        .update(playlistItems)
        .set({ position })
        .where(
          and(
            eq(playlistItems.playlistId, playlist.id),
            eq(playlistItems.videoId, videoId)
          )
        );
    }
  });

  await notifyPlaylistChanged(profileId);
}
