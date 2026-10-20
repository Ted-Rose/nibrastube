-- Self-heal for the 13+ gate regression: while getVideosBatch filtered
-- made-for-kids rows at ingestion, backfills that ran under the gate
-- silently skipped made-for-kids uploads, and pollChannel never
-- revisits pages behind its "newest uploads" cursor. Reset channels
-- whose backfill is in-flight (earlier pages may have dropped
-- made-for-kids videos) or completed with zero pins (the gate
-- swallowed the whole catalog) so they re-run under ungated
-- ingestion. The re-walk is idempotent (whitelisted_videos inserts
-- use onConflictDoNothing); NULL last_sync_at sorts them first in
-- syncAllChannels' nulls-first ordering.
UPDATE "whitelisted_channels" AS wc
SET "backfill_complete" = false,
    "backfill_page_token" = NULL,
    "last_sync_at" = NULL
WHERE (wc."backfill_complete" = false AND wc."backfill_page_token" IS NOT NULL)
   OR (wc."backfill_complete" = true AND NOT EXISTS (
        SELECT 1 FROM "whitelisted_videos" AS wv
        WHERE wv."profile_id" = wc."profile_id"
          AND wv."via_channel_id" = wc."channel_id"));
