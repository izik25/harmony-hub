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
  // Nullable because an account can be created via phone or Google sign-in without ever setting
  // one of these — a user still has at least one of email/phone/googleId, just not all three.
  email: text("email").unique(),
  phone: text("phone").unique(),
  googleId: text("google_id").unique(),
  passwordHash: text("password_hash"),
  avatarUrl: text("avatar_url").notNull(),
  bio: text("bio").notNull().default(""),
  verified: boolean("verified").notNull().default(false),
  voiceType: text("voice_type").notNull().default(""),
  country: text("country").notNull().default(""),
  openToLabel: boolean("open_to_label").notNull().default(false),
  coinsBalance: integer("coins_balance").notNull().default(500),
  accountType: text("account_type").notNull().default("user"), // user | artist
  isPro: boolean("is_pro").notNull().default(false),
  role: text("role").notNull().default("user"), // user | admin
  isBanned: boolean("is_banned").notNull().default(false),
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
  // Where in backingTrackUrl the take actually started singing along (KaraokeSegmentPicker's
  // "choose a part" start, in seconds — 0 for the whole song). processRecording needs this to
  // offset the backing track it mixes in so it lines up with the vocal instead of always starting
  // from the song's own beginning; Studio's re-bake (Mix Balance / AI Mastering) needs it for the
  // same reason whenever it re-runs that mix later.
  backingStartOffsetSeconds: integer("backing_start_offset_seconds").notNull().default(0),
  // Which curated karaoke track this take was recorded over, if any — lets the feed link a post
  // back to that track's "sound page" (usage count + every other video recorded over it), the same
  // way TikTok links a post to the sound it used. Null for original songs, plain uploads, and any
  // take from before this column existed.
  karaokeTrackId: uuid("karaoke_track_id").references(() => karaokeTracks.id, {
    onDelete: "set null",
  }),
  coverUrl: text("cover_url").notNull().default(""),
  // A self-recorded (webcam + karaoke) or manually-uploaded performance video. When set, this is
  // what plays in the feed for this post instead of audioUrl + coverUrl — see FeedItem in
  // src/routes/index.tsx.
  videoUrl: text("video_url").notNull().default(""),
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
  // Set only for gifts that are also a wearable face filter (party hat, sunglasses, mask, ...) —
  // see src/lib/face-filters.ts for the matching FilterKind values. Null for plain coin-value
  // gifts (rose, mic, diamond, ...), which have no visual effect of their own beyond the emoji.
  filterKind: text("filter_kind"),
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
  kind: text("kind").notNull(), // topup | withdraw | gift_sent | gift_received | pro_purchase | export_purchase
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

// Every non-host on-stage participant of a live room — both the single guest a "Challenge to
// Duet" invite seats (ProfileView's ⚔️ button) and anyone the host invites up on stage mid-stream
// (up to a handful at once). Single source of truth for the room's roster: the room page renders
// one tile per "live" row here alongside the host, and joinRoom's role resolution checks this
// table instead of a fixed opponent column, so any number of guests works the same way whether
// they were seated at room creation or invited later.
export const liveRoomGuests = pgTable("live_room_guests", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => liveRooms.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("invited"), // invited | live | removed | left
  invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
  removedAt: timestamp("removed_at", { withTimezone: true }),
});

// Links two independently-hosted, already-live rooms into a TikTok-style "PK" battle — gifts sent
// into either room while status is "active" add to that room's side (see sendGift in
// functions/wallet.ts, and giftEvents.roomId below), and whichever score is ahead when the timer
// runs out wins. Deliberately not modeled as a special liveRooms.type: either room can be a plain
// "set"/"acoustic"/"battle" broadcast on its own, running normally, right up until someone links
// it into a PK — the battle is an relationship *between* two rooms, not a property of one.
export const livePkBattles = pgTable("live_pk_battles", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomAId: uuid("room_a_id")
    .notNull()
    .references(() => liveRooms.id, { onDelete: "cascade" }),
  roomBId: uuid("room_b_id")
    .notNull()
    .references(() => liveRooms.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"), // pending | active | ended | declined
  durationSeconds: integer("duration_seconds").notNull().default(180),
  scoreA: integer("score_a").notNull().default(0),
  scoreB: integer("score_b").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  winnerRoomId: uuid("winner_room_id").references(() => liveRooms.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const karaokeTracks = pgTable("karaoke_tracks", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  artist: text("artist").notNull().default(""),
  videoUrl: text("video_url").notNull().unique(),
  durationSeconds: integer("duration_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// The curated singer roster shown on the "choose karaoke" artist grid. Deliberately a separate
// table from karaokeTracks (matched by `name` == karaokeTracks.artist, not a FK) so the roster —
// with its photo — can be curated ahead of any actual .mp4s existing for that singer, and so
// sync-karaoke.ts (which only ever touches karaokeTracks, keyed by videoUrl) doesn't need to
// change at all.
export const karaokeArtists = pgTable("karaoke_artists", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  imageUrl: text("image_url").notNull().default(""),
  position: integer("position").notNull().default(0),
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

// One row per artist (users.accountType === "artist") holding the channel/profile-level links
// shown on their public "artist card" — as opposed to platformConnections, which is OAuth
// upload credentials for the publish flow. These are plain link-out URLs the artist pastes in.
export const artistProfiles = pgTable("artist_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  genre: text("genre").notNull().default(""),
  label: text("label").notNull().default(""),
  spotifyUrl: text("spotify_url").notNull().default(""),
  youtubeUrl: text("youtube_url").notNull().default(""),
  appleMusicUrl: text("apple_music_url").notNull().default(""),
  soundcloudUrl: text("soundcloud_url").notNull().default(""),
  instagramUrl: text("instagram_url").notNull().default(""),
  tiktokUrl: text("tiktok_url").notNull().default(""),
  websiteUrl: text("website_url").notNull().default(""),
  wikipediaUrl: text("wikipedia_url").notNull().default(""),
  ticketsUrl: text("tickets_url").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Discography entries shown on the artist card — link-outs to where the song lives on each
// platform, not playable in-app (that's what `posts` is for).
export const artistSongs = pgTable("artist_songs", {
  id: uuid("id").defaultRandom().primaryKey(),
  artistUserId: uuid("artist_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  coverUrl: text("cover_url").notNull().default(""),
  releaseYear: integer("release_year"),
  spotifyUrl: text("spotify_url").notNull().default(""),
  youtubeUrl: text("youtube_url").notNull().default(""),
  appleMusicUrl: text("apple_music_url").notNull().default(""),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per promotion request — either a user "boosting" one of their own posts (kind
// "boost", tied to userId/postId, coins pre-charged into escrow when submitted) or a sponsor/
// business ad placed directly by an admin (kind "sponsor_ad", no in-app user attached). Both
// flow through the same pending -> approved/rejected admin review queue. `status` only ever
// stores those three values — whether an approved promotion is currently "active" or already
// "completed" is derived by comparing endAt to now, not stored, so nothing needs a background
// job to keep it in sync.
export const promotions = pgTable("promotions", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: text("kind").notNull(), // boost | sponsor_ad
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
  description: text("description").notNull().default(""),
  imageUrl: text("image_url").notNull().default(""),
  targetUrl: text("target_url").notNull().default(""),
  advertiserName: text("advertiser_name").notNull().default(""),
  budgetCoins: integer("budget_coins").notNull().default(0),
  durationDays: integer("duration_days").notNull().default(1),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  rejectionReason: text("rejection_reason").notNull().default(""),
  reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  startAt: timestamp("start_at", { withTimezone: true }),
  endAt: timestamp("end_at", { withTimezone: true }),
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Upcoming show/tour dates with a per-show ticket link, shown on the artist card.
export const artistShows = pgTable("artist_shows", {
  id: uuid("id").defaultRandom().primaryKey(),
  artistUserId: uuid("artist_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  venue: text("venue").notNull().default(""),
  city: text("city").notNull().default(""),
  showDate: timestamp("show_date", { withTimezone: true }),
  ticketUrl: text("ticket_url").notNull().default(""),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
