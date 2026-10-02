CREATE TABLE "video_reactions" (
	"profile_id" uuid NOT NULL,
	"video_id" text NOT NULL,
	"reaction" text NOT NULL,
	"reacted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_reactions_profile_id_video_id_pk" PRIMARY KEY("profile_id","video_id")
);
--> statement-breakpoint
ALTER TABLE "video_reactions" ADD CONSTRAINT "video_reactions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_reactions" ADD CONSTRAINT "video_reactions_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;