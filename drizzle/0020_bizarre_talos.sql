CREATE TABLE "song_reactions" (
	"profile_id" uuid NOT NULL,
	"song_id" uuid NOT NULL,
	"reaction" text NOT NULL,
	"reacted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "song_reactions_profile_id_song_id_pk" PRIMARY KEY("profile_id","song_id")
);
--> statement-breakpoint
ALTER TABLE "song_reactions" ADD CONSTRAINT "song_reactions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "song_reactions" ADD CONSTRAINT "song_reactions_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE cascade ON UPDATE no action;