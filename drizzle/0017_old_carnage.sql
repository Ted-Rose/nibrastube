CREATE TABLE "video_impressions" (
	"profile_id" uuid NOT NULL,
	"video_id" text NOT NULL,
	"seen_days" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_seen_on" date NOT NULL,
	CONSTRAINT "video_impressions_profile_id_video_id_pk" PRIMARY KEY("profile_id","video_id")
);
--> statement-breakpoint
ALTER TABLE "video_impressions" ADD CONSTRAINT "video_impressions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_impressions" ADD CONSTRAINT "video_impressions_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;