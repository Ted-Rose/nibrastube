CREATE TABLE "channel_sync_exclusions" (
	"parent_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"excluded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channel_sync_exclusions_parent_id_channel_id_pk" PRIMARY KEY("parent_id","channel_id")
);
--> statement-breakpoint
ALTER TABLE "channel_sync_exclusions" ADD CONSTRAINT "channel_sync_exclusions_parent_id_users_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_sync_exclusions" ADD CONSTRAINT "channel_sync_exclusions_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;