import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import {
  getVideosBatch,
  videoRowValues,
  type FullVideoDetails,
} from "@/lib/youtube";

// Upsert full API details into the `videos` cache. Every mutable column
// is overwritten, so a stale row gains any field it was missing. Shared
// by channel sync and scripts/refresh-videos.ts — keep the column list
// complete here rather than duplicating it per caller.
export async function upsertVideoRows(details: FullVideoDetails[]) {
  if (details.length === 0) return;

  await db
    .insert(videos)
    .values(details.map(videoRowValues))
    .onConflictDoUpdate({
      target: videos.id,
      set: {
        title: sql`excluded.title`,
        thumbnail: sql`excluded.thumbnail`,
        channelTitle: sql`excluded.channel_title`,
        channelId: sql`excluded.channel_id`,
        publishedAt: sql`excluded.published_at`,
        durationSeconds: sql`excluded.duration_seconds`,
        description: sql`excluded.description`,
        tags: sql`excluded.tags`,
        categoryId: sql`excluded.category_id`,
        defaultLanguage: sql`excluded.default_language`,
        defaultAudioLanguage: sql`excluded.default_audio_language`,
        liveBroadcastContent: sql`excluded.live_broadcast_content`,
        madeForKids: sql`excluded.made_for_kids`,
        ageRestricted: sql`excluded.age_restricted`,
        embeddable: sql`excluded.embeddable`,
        privacyStatus: sql`excluded.privacy_status`,
        hasCaptions: sql`excluded.has_captions`,
        definition: sql`excluded.definition`,
        viewCount: sql`excluded.view_count`,
        likeCount: sql`excluded.like_count`,
        fetchedAt: sql`excluded.fetched_at`,
        raw: sql`excluded.raw`,
      },
    });
}

export interface RefreshResult {
  // Videos that came back from YouTube healthy (embeddable) and were
  // upserted into the cache.
  refreshed: string[];
  // Ids YouTube did not return — deleted/private/non-embeddable upstream.
  // Their rows are left untouched; callers decide whether to prune.
  missing: string[];
}

// Re-fetch a set of cached video ids via videos.list (50 ids per API
// call, 1 quota unit each) and overwrite their rows. getVideosBatch
// already filters out non-embeddable videos, so anything absent from
// `refreshed` can't play in the kid embed anyway.
export async function refreshVideoIds(ids: string[]): Promise<RefreshResult> {
  const details = await getVideosBatch(ids);
  await upsertVideoRows(details);
  const returned = new Set(details.map((d) => d.id));
  return {
    refreshed: details.map((d) => d.id),
    missing: ids.filter((id) => !returned.has(id)),
  };
}
