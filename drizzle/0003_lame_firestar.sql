CREATE TABLE "watch_progress" (
	"profile_id" uuid NOT NULL,
	"video_id" text NOT NULL,
	"position_seconds" integer DEFAULT 0 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"watched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watch_progress_profile_id_video_id_pk" PRIMARY KEY("profile_id","video_id")
);
--> statement-breakpoint
ALTER TABLE "watch_progress" ADD CONSTRAINT "watch_progress_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_progress" ADD CONSTRAINT "watch_progress_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;