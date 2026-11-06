ALTER TABLE "videos" ADD COLUMN "playback_blocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "blocked_at" timestamp with time zone;