CREATE TABLE "watch_history" (
	"profile_id" uuid NOT NULL,
	"video_id" text NOT NULL,
	"watched_on" date NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "watch_history_profile_id_video_id_watched_on_pk" PRIMARY KEY("profile_id","video_id","watched_on")
);
--> statement-breakpoint
ALTER TABLE "watch_history" ADD CONSTRAINT "watch_history_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_history" ADD CONSTRAINT "watch_history_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Backfill from watch_progress: seeds existing history. watched_on is the
-- UTC date of the last beacon (approximation for pre-feature data).
insert into watch_history (profile_id, video_id, watched_on, last_seen_at)
select profile_id, video_id, watched_at::date, watched_at
from watch_progress
on conflict do nothing;