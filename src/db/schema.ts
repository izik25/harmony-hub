import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  handle: text("handle").notNull().unique(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  avatarUrl: text("avatar_url").notNull(),
  bio: text("bio").notNull().default(""),
  verified: boolean("verified").notNull().default(false),
  voiceType: text("voice_type").notNull().default(""),
  country: text("country").notNull().default(""),
  openToLabel: boolean("open_to_label").notNull().default(false),
  coinsBalance: integer("coins_balance").notNull().default(500),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const posts = pgTable("posts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // cover | original | djset | teaser | competition
  title: text("title").notNull(),
  songTitle: text("song_title").notNull().default(""),
  audioUrl: text("audio_url").notNull().default(""),
  // Pre-mix source material for a draft recorded via /record — kept around so the Studio screen
  // can re-balance vocal vs. backing track and re-bake audioUrl without re-recording. Empty for
  // anything published without going through that flow (plain uploads, older drafts, etc.).
  rawVocalUrl: text("raw_vocal_url").notNull().default(""),
  backingTrackUrl: text("backing_track_url").notNull().default(""),
  coverUrl: text("cover_url").notNull().default(""),
  hue: integer("hue").notNull().default(300),
  credits: jsonb("credits")
    .$type<{ performer: string; writer: string; composer: string; producer: string }>()
    .notNull(),
  tags: text("tags").array().notNull().default([]),
  category: text("category").notNull().default(""),
  visibility: text("visibility").notNull().default("public"), // public | private
  status: text("status").notNull().default("published"), // draft | published
  likesCount: integer("likes_count").notNull().default(0),
  commentsCount: integer("comments_count").notNull().default(0),
  sharesCount: integer("shares_count").notNull().default(0),
  giftsCount: integer("gifts_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const likes = pgTable(
  "likes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("likes_user_post_uq").on(t.userId, t.postId)],
);

export const follows = pgTable(
  "follows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    followerId: uuid("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followeeId: uuid("followee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("follows_pair_uq").on(t.followerId, t.followeeId)],
);

export const comments = pgTable("comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  postId: uuid("post_id")
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const giftsCatalog = pgTable("gifts_catalog", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  emoji: text("emoji").notNull(),
  coins: integer("coins").notNull(),
});

export const giftEvents = pgTable("gift_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  fromUserId: uuid("from_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  toUserId: uuid("to_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
  roomId: text("room_id"),
  giftId: text("gift_id")
    .notNull()
    .references(() => giftsCatalog.id),
  coins: integer("coins").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const walletTransactions = pgTable("wallet_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // topup | withdraw | gift_sent | gift_received
  coins: integer("coins").notNull(), // signed delta
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const competitions = pgTable("competitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  stage: text("stage").notNull(), // quarter | semi | final
  status: text("status").notNull().default("active"), // active | upcoming | finished
  prize: text("prize").notNull(),
  coverSeed: text("cover_seed").notNull(),
  hue: integer("hue").notNull().default(300),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const competitionEntries = pgTable(
  "competition_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    votesCount: integer("votes_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("comp_entry_uq").on(t.competitionId, t.userId)],
);

export const competitionVotes = pgTable(
  "competition_votes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => competitionEntries.id, { onDelete: "cascade" }),
    voterId: uuid("voter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("comp_vote_uq").on(t.competitionId, t.voterId)],
);

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }), // recipient
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // like | follow | gift | comment | invited | contact_request
  postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
  extra: jsonb("extra").$type<Record<string, string | number | boolean>>().notNull().default({}),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userA: uuid("user_a")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userB: uuid("user_b")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("conversations_pair_uq").on(t.userA, t.userB)],
);

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditions = pgTable("auditions", {
  id: uuid("id").defaultRandom().primaryKey(),
  labelUserId: uuid("label_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditionApplications = pgTable(
  "audition_applications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    auditionId: uuid("audition_id")
      .notNull()
      .references(() => auditions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("audition_app_uq").on(t.auditionId, t.userId)],
);

export const savedAuditions = pgTable(
  "saved_auditions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    auditionId: uuid("audition_id")
      .notNull()
      .references(() => auditions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("saved_audition_uq").on(t.auditionId, t.userId)],
);

export const liveRooms = pgTable("live_rooms", {
  id: uuid("id").defaultRandom().primaryKey(),
  hostId: uuid("host_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  type: text("type").notNull().default("set"), // battle | set | acoustic
  status: text("status").notNull().default("live"), // live | ended
  livekitRoomName: text("livekit_room_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const karaokeTracks = pgTable("karaoke_tracks", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  artist: text("artist").notNull().default(""),
  videoUrl: text("video_url").notNull().unique(),
  durationSeconds: integer("duration_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per (user, external platform) OAuth connection used by the "Publish everywhere" flow.
// Tokens are stored as-is (no app-level encryption) — acceptable for now since this whole table
// is only ever read from trusted server code (functions/platforms.ts, lib/social-platforms/*),
// same trust boundary as sessions.id already sitting in plaintext in this DB.
export const platformConnections = pgTable(
  "platform_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(), // youtube | tiktok | instagram
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull().default(""),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    externalAccountId: text("external_account_id").notNull().default(""),
    externalAccountName: text("external_account_name").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("platform_conn_user_platform_uq").on(t.userId, t.platform)],
);

// One row per (post, platform) publish attempt triggered from the "Publish everywhere" modal.
// `platform` also covers the link-out-only targets (spotify/apple_music/soundcloud) so the UI has
// one place to read status/history from regardless of how a given platform is actually handled.
export const platformPublishes = pgTable("platform_publishes", {
  id: uuid("id").defaultRandom().primaryKey(),
  postId: uuid("post_id")
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  status: text("status").notNull().default("pending"), // pending | processing | success | failed
  externalUrl: text("external_url").notNull().default(""),
  externalId: text("external_id").notNull().default(""),
  error: text("error").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
