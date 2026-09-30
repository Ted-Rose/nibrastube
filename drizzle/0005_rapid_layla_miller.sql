ALTER TABLE "channels" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "subscriber_count" bigint;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "video_count" bigint;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "raw" jsonb;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "category_id" integer;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "default_language" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "default_audio_language" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "live_broadcast_content" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "made_for_kids" boolean;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "age_restricted" boolean;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "embeddable" boolean;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "privacy_status" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "has_captions" boolean;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "definition" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "view_count" bigint;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "like_count" bigint;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "raw" jsonb;