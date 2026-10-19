ALTER TABLE "videos" ADD COLUMN "is_short" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill: same heuristic the app derives at fetch time — YouTube's API
-- exposes no Shorts flag, so a video counts as a Short when it's <=60s or
-- carries the "#shorts" hashtag in title/description/tags.
UPDATE "videos" SET "is_short" = true
WHERE "duration_seconds" <= 60
   OR "title" ILIKE '%#shorts%'
   OR "description" ILIKE '%#shorts%'
   OR "tags"::text ILIKE '%#shorts%';
