-- Data cleanup for the age-suitability floor
-- (docs/plans/age-suitability-filter-plan.md): the query-time
-- `suitableVideo` guard now hides every age-restricted video from
-- kids, but existing pins on restricted videos would linger as inert
-- rows (5 pins on 3 videos as of 2026-10-20). Tombstone the
-- channel-synced ones first so the next sync can't re-pin them
-- (tombstones stop re-pinning only — pollChannel still re-fetches
-- the video each run since getExcludedVideoIds filters after
-- getVideosBatch, which is harmless), then delete every pin on a
-- restricted video —
-- manual and synced. The `videos` rows stay: they're inert once
-- unpinned, and deleting them would cascade
-- watch_history/watch_progress/video_reactions for no gain.
INSERT INTO "channel_video_exclusions" ("profile_id", "video_id")
SELECT wv."profile_id", wv."video_id"
FROM "whitelisted_videos" wv
JOIN "videos" v ON v."id" = wv."video_id"
WHERE v."age_restricted" IS TRUE
  AND wv."via_channel_id" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint

DELETE FROM "whitelisted_videos" wv
USING "videos" v
WHERE v."id" = wv."video_id"
  AND v."age_restricted" IS TRUE;
