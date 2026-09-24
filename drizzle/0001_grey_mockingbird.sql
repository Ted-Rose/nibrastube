CREATE TABLE "channel_video_exclusions" (
	"profile_id" uuid NOT NULL,
	"video_id" text NOT NULL,
	CONSTRAINT "channel_video_exclusions_profile_id_video_id_pk" PRIMARY KEY("profile_id","video_id")
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"thumbnail" text,
	"uploads_playlist_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_syncs" (
	"sync_date" text PRIMARY KEY NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"channels_synced" integer
);
--> statement-breakpoint
CREATE TABLE "whitelisted_channels" (
	"profile_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"approved_at" timestamp DEFAULT now() NOT NULL,
	"backfill_complete" boolean DEFAULT false NOT NULL,
	"backfill_page_token" text,
	"last_sync_at" timestamp,
	CONSTRAINT "whitelisted_channels_profile_id_channel_id_pk" PRIMARY KEY("profile_id","channel_id")
);
--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "channel_id" text;--> statement-breakpoint
ALTER TABLE "whitelisted_videos" ADD COLUMN "via_channel_id" text;--> statement-breakpoint
ALTER TABLE "channel_video_exclusions" ADD CONSTRAINT "channel_video_exclusions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_video_exclusions" ADD CONSTRAINT "channel_video_exclusions_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whitelisted_channels" ADD CONSTRAINT "whitelisted_channels_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whitelisted_channels" ADD CONSTRAINT "whitelisted_channels_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;