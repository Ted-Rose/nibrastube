import { pgTable, text, timestamp, uuid, boolean, integer, bigint, jsonb, primaryKey } from "drizzle-orm/pg-core";

// Parent Users
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  parentPin: text("parent_pin").default("0000").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Kid Profiles
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  parentId: uuid("parent_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  avatar: text("avatar"), // URL or base64 or emoji
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// YouTube Videos Cache/Registry
export const videos = pgTable("videos", {
  id: text("id").primaryKey(), // YouTube Video ID
  title: text("title").notNull(),
  thumbnail: text("thumbnail").notNull(),
  channelTitle: text("channel_title").notNull(),
  channelId: text("channel_id"), // YouTube Channel ID (UC...)
  publishedAt: timestamp("published_at", { withTimezone: true }), // YouTube publish time; null for older cached rows
  durationSeconds: integer("duration_seconds"), // total length; null if API didn't return it
  // Rich metadata from videos.list (snippet/contentDetails/status/statistics)
  description: text("description"),
  tags: jsonb("tags"), // string[] of uploader tags
  categoryId: integer("category_id"), // YouTube video category (27 = Education)
  defaultLanguage: text("default_language"),
  defaultAudioLanguage: text("default_audio_language"),
  liveBroadcastContent: text("live_broadcast_content"), // none | live | upcoming
  madeForKids: boolean("made_for_kids"), // YouTube's own kids flag
  ageRestricted: boolean("age_restricted"), // contentRating.ytRating === ytAgeRestricted
  embeddable: boolean("embeddable"), // can play in the IFrame embed
  privacyStatus: text("privacy_status"), // public | unlisted | private
  hasCaptions: boolean("has_captions"),
  definition: text("definition"), // hd | sd
  viewCount: bigint("view_count", { mode: "number" }),
  likeCount: bigint("like_count", { mode: "number" }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }), // last API refresh; null = stale row from before these columns
  raw: jsonb("raw"), // full videos.list item for fields we didn't promote
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// YouTube Channels Registry
export const channels = pgTable("channels", {
  id: text("id").primaryKey(), // YouTube Channel ID (UC...)
  title: text("title").notNull(),
  thumbnail: text("thumbnail"),
  uploadsPlaylistId: text("uploads_playlist_id"),
  description: text("description"),
  country: text("country"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  subscriberCount: bigint("subscriber_count", { mode: "number" }),
  videoCount: bigint("video_count", { mode: "number" }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }), // last API refresh
  raw: jsonb("raw"), // full channels.list item
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Whitelisted Videos for Profiles
export const whitelistedVideos = pgTable(
  "whitelisted_videos",
  {
    profileId: uuid("profile_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    videoId: text("video_id")
      .references(() => videos.id, { onDelete: "cascade" })
      .notNull(),
    viaChannelId: text("via_channel_id"), // null = manually pinned; set = auto-added via approved channel
    pinnedAt: timestamp("pinned_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.profileId, table.videoId] }),
  })
);

// Approved Channels for Profiles
export const whitelistedChannels = pgTable(
  "whitelisted_channels",
  {
    profileId: uuid("profile_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    channelId: text("channel_id")
      .references(() => channels.id, { onDelete: "cascade" })
      .notNull(),
    approvedAt: timestamp("approved_at").defaultNow().notNull(),
    backfillComplete: boolean("backfill_complete").default(false).notNull(),
    backfillPageToken: text("backfill_page_token"), // resume cursor for large channels
    lastSyncAt: timestamp("last_sync_at"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.profileId, table.channelId] }),
  })
);

// Watch progress per (profile, video): latest position wins, one row upserted
export const watchProgress = pgTable(
  "watch_progress",
  {
    profileId: uuid("profile_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    videoId: text("video_id")
      .references(() => videos.id, { onDelete: "cascade" })
      .notNull(),
    positionSeconds: integer("position_seconds").default(0).notNull(),
    completed: boolean("completed").default(false).notNull(), // >= ~95% or ENDED
    watchedAt: timestamp("watched_at", { withTimezone: true })
      .defaultNow()
      .notNull(), // last flush time
  },
  (table) => ({
    pk: primaryKey({ columns: [table.profileId, table.videoId] }),
  })
);

// Tombstones: videos a parent explicitly unpinned from an approved channel,
// so the sync does not re-add them
export const channelVideoExclusions = pgTable(
  "channel_video_exclusions",
  {
    profileId: uuid("profile_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    videoId: text("video_id")
      .references(() => videos.id, { onDelete: "cascade" })
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.profileId, table.videoId] }),
  })
);

// Daily sync dedup lock: one row per UTC day means the sync already ran
export const dailySyncs = pgTable("daily_syncs", {
  syncDate: text("sync_date").primaryKey(), // UTC date, YYYY-MM-DD
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  channelsSynced: integer("channels_synced"),
});

// Shared Access (Invite another parent to manage profiles)
export const sharedAccess = pgTable(
  "shared_access",
  {
    parentId: uuid("parent_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    profileId: uuid("profile_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role").default("editor").notNull(), // editor/viewer
  },
  (table) => ({
    pk: primaryKey({ columns: [table.parentId, table.profileId] }),
  })
);

// Invites
export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  fromParentId: uuid("from_parent_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  profileId: uuid("profile_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  status: text("status").default("pending").notNull(), // pending, accepted, rejected
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
