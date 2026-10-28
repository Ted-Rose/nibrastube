import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  integer,
  bigint,
  jsonb,
  primaryKey,
  uniqueIndex,
  date,
} from "drizzle-orm/pg-core";

// Parent Users
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  parentPin: text("parent_pin").default("0000").notNull(),
  // YT handle whose timestamped comments get imported as songs
  songCommenterHandle: text("song_commenter_handle"),
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
  // Optional login credentials: username shares one identifier namespace
  // with users.email (enforced at write time in signup/setKidCredentials).
  // Both nullable — a profile without them simply has no kid login.
  username: text("username").unique(),
  passwordHash: text("password_hash"),
  // kid may swipe to switch videos on the watch page
  swipeEnabled: boolean("swipe_enabled").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// YouTube Videos Cache/Registry
export const videos = pgTable("videos", {
  id: text("id").primaryKey(), // YouTube Video ID
  title: text("title").notNull(),
  thumbnail: text("thumbnail").notNull(),
  channelTitle: text("channel_title").notNull(),
  channelId: text("channel_id"), // YouTube Channel ID (UC...)
  // YouTube publish time; null for older cached rows
  publishedAt: timestamp("published_at", { withTimezone: true }),
  // total length; null if API didn't return it
  durationSeconds: integer("duration_seconds"),
  // Rich metadata from videos.list (snippet/contentDetails/status/statistics)
  description: text("description"),
  tags: jsonb("tags"), // string[] of uploader tags
  // YouTube video category (27 = Education)
  categoryId: integer("category_id"),
  defaultLanguage: text("default_language"),
  defaultAudioLanguage: text("default_audio_language"),
  // none | live | upcoming
  liveBroadcastContent: text("live_broadcast_content"),
  madeForKids: boolean("made_for_kids"), // YouTube's own kids flag
  // contentRating.ytRating === ytAgeRestricted
  ageRestricted: boolean("age_restricted"),
  embeddable: boolean("embeddable"), // can play in the IFrame embed
  privacyStatus: text("privacy_status"), // public | unlisted | private
  hasCaptions: boolean("has_captions"),
  definition: text("definition"), // hd | sd
  viewCount: bigint("view_count", { mode: "number" }),
  likeCount: bigint("like_count", { mode: "number" }),
  // YouTube's API exposes no Shorts flag — derived at fetch time:
  // duration <= 60s or "#shorts" in title/description/tags.
  isShort: boolean("is_short").default(false).notNull(),
  // last API refresh; null = stale row from before these columns
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
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
  // last API refresh
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  raw: jsonb("raw"), // full channels.list item
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Songs parsed from timestamped tracklist comments on compilation
// videos (live streams, medleys, albums). Global registry like
// videos/channels — NOT tied to a kid profile or the whitelist.
// (videoId, startSeconds) is unique: two commenters' tracklists for the
// same video merge on shared boundaries, last import wins via upsert.
export const songs = pgTable(
  "songs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: text("video_id")
      .references(() => videos.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    startSeconds: integer("start_seconds").notNull(),
    // null = "play to the end of the video" — the comment gave a bare
    // start and there is no next song to bound it.
    endSeconds: integer("end_seconds"),
    // YT comment id — re-import identity
    sourceCommentId: text("source_comment_id"),
    sourceHandle: text("source_handle"), // normalized handle, no "@"
    importedBy: uuid("imported_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqueVideoStart: uniqueIndex("songs_video_start_uniq").on(
      table.videoId,
      table.startSeconds
    ),
  })
);

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
    // null = manually pinned; set = auto-added via approved channel
    viaChannelId: text("via_channel_id"),
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
    // resume cursor for large channels
    backfillPageToken: text("backfill_page_token"),
    lastSyncAt: timestamp("last_sync_at"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.profileId, table.channelId] }),
  })
);

// Channels a parent has muted: sync never fetches uploads for these
// (profile owner) + channel pairs. Survives un-approve/re-approve —
// a muted channel stays muted.
export const channelSyncExclusions = pgTable(
  "channel_sync_exclusions",
  {
    parentId: uuid("parent_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    channelId: text("channel_id")
      .references(() => channels.id, { onDelete: "cascade" })
      .notNull(),
    excludedAt: timestamp("excluded_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.parentId, table.channelId] }),
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
    // >= ~95% or ENDED
    completed: boolean("completed").default(false).notNull(),
    watchedAt: timestamp("watched_at", { withTimezone: true })
      .defaultNow()
      .notNull(), // last flush time
  },
  (table) => ({
    pk: primaryKey({ columns: [table.profileId, table.videoId] }),
  })
);

// One row per (profile, video, day): the kid-local date a video had any
// watch activity. Append-only-per-day; lastSeenAt tracks intra-day
// recency for ordering and "watched at 3:42 PM" labels.
export const watchHistory = pgTable(
  "watch_history",
  {
    profileId: uuid("profile_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    videoId: text("video_id")
      .references(() => videos.id, { onDelete: "cascade" })
      .notNull(),
    watchedOn: date("watched_on", { mode: "string" }).notNull(), // YYYY-MM-DD
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.profileId, table.videoId, table.watchedOn],
    }),
  })
);

// Kid reactions per (profile, video): one row, latest wins.
// "like" | "dislike" — text column leaves room for more reactions later.
export const videoReactions = pgTable(
  "video_reactions",
  {
    profileId: uuid("profile_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    videoId: text("video_id")
      .references(() => videos.id, { onDelete: "cascade" })
      .notNull(),
    reaction: text("reaction").notNull(), // "like" | "dislike"
    reactedAt: timestamp("reacted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.profileId, table.videoId] }),
  })
);

// "Shown but ignored" feed impressions per (profile, video): a grid
// card ≥50% visible for ≥1s without a tap. A weak negative ranking
// signal (lib/kids-feed.ts `impressionPenalty`); written silently by
// /api/impressions, pruned there after ~45 days without a sighting.
export const videoImpressions = pgTable(
  "video_impressions",
  {
    profileId: uuid("profile_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    videoId: text("video_id")
      .references(() => videos.id, { onDelete: "cascade" })
      .notNull(),
    // Days this card was shown ≥1s without a tap — the upsert
    // increments it at most once per kid-local day.
    seenDays: integer("seen_days").default(1).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull(), // server-now of the last accepted write
    // Kid-local YYYY-MM-DD of that write — the per-day dedup key
    // (same client-controlled trust posture as watch_history.day).
    lastSeenOn: date("last_seen_on", { mode: "string" }).notNull(),
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

// Kid-created playlists, scoped to a profile.
export const playlists = pgTable("playlists", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Ordered playlist membership. Rows survive unpinning (no FK to
// whitelisted_videos); reads inner-join the whitelist so an unpinned
// item hides and silently returns on re-pin — same rule as
// video_reactions/watch_progress.
export const playlistItems = pgTable(
  "playlist_items",
  {
    playlistId: uuid("playlist_id")
      .references(() => playlists.id, { onDelete: "cascade" })
      .notNull(),
    videoId: text("video_id")
      .references(() => videos.id, { onDelete: "cascade" })
      .notNull(),
    position: integer("position").notNull(), // compact 0..n-1
    addedAt: timestamp("added_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.playlistId, table.videoId] }),
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
  // pending, accepted, rejected
  status: text("status").default("pending").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
