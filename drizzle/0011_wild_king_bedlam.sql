CREATE TABLE "songs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" text NOT NULL,
	"title" text NOT NULL,
	"start_seconds" integer NOT NULL,
	"end_seconds" integer,
	"source_comment_id" text,
	"source_handle" text,
	"imported_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "song_commenter_handle" text;--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "songs_video_start_uniq" ON "songs" USING btree ("video_id","start_seconds");