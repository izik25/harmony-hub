// Mock data used across screens for a realistic UI-only prototype.

export type PostType = "cover" | "original" | "djset" | "teaser" | "competition";

export interface FeedPost {
  id: string;
  type: PostType;
  title: string;
  song: string;
  user: { name: string; handle: string; verified: boolean; avatar: string };
  cover: string;
  likes: number;
  comments: number;
  shares: number;
  gifts: number;
  credits: { performer: string; writer: string; composer: string; producer: string };
  hue: number;
}

const avatars = (seed: string) => `https://api.dicebear.com/9.x/glass/svg?seed=${seed}`;
const cover = (h: number, s: string) => `https://picsum.photos/seed/${s}/720/1280`;

export const feedPosts: FeedPost[] = [
  {
    id: "1",
    type: "cover",
    title: "Cover of a classic",
    song: "Blinding Lights — The Weeknd",
    hue: 320,
    user: { name: "Nova Ray", handle: "@novaray", verified: true, avatar: avatars("nova") },
    cover: cover(320, "nova1"),
    likes: 128400,
    comments: 2340,
    shares: 890,
    gifts: 421,
    credits: {
      performer: "Nova Ray",
      writer: "A. Tesfaye",
      composer: "M. Quenneville",
      producer: "Max Martin",
    },
  },
  {
    id: "2",
    type: "competition",
    title: "Semifinal round entry",
    song: "Original — Neon Skies",
    hue: 280,
    user: { name: "Kai Aster", handle: "@kaiaster", verified: false, avatar: avatars("kai") },
    cover: cover(280, "kai1"),
    likes: 54320,
    comments: 1204,
    shares: 210,
    gifts: 88,
    credits: {
      performer: "Kai Aster",
      writer: "Kai Aster",
      composer: "Kai Aster",
      producer: "Zen Lab",
    },
  },
  {
    id: "3",
    type: "djset",
    title: "Midnight rooftop set",
    song: "DJ Nyx — Midnight Rooftop",
    hue: 200,
    user: { name: "DJ Nyx", handle: "@djnyx", verified: true, avatar: avatars("nyx") },
    cover: cover(200, "nyx1"),
    likes: 88120,
    comments: 502,
    shares: 1210,
    gifts: 302,
    credits: { performer: "DJ Nyx", writer: "—", composer: "DJ Nyx", producer: "DJ Nyx" },
  },
  {
    id: "4",
    type: "teaser",
    title: "New single drops Friday",
    song: "Teaser — Velvet Static",
    hue: 340,
    user: { name: "Lila Moon", handle: "@lilamoon", verified: true, avatar: avatars("lila") },
    cover: cover(340, "lila1"),
    likes: 33210,
    comments: 809,
    shares: 402,
    gifts: 133,
    credits: {
      performer: "Lila Moon",
      writer: "L. Moon / R. Vale",
      composer: "L. Moon",
      producer: "R. Vale",
    },
  },
  {
    id: "5",
    type: "original",
    title: "Studio session — take 3",
    song: "Original — Gold Circuit",
    hue: 250,
    user: { name: "Atlas Vex", handle: "@atlasvex", verified: false, avatar: avatars("atlas") },
    cover: cover(250, "atlas1"),
    likes: 21100,
    comments: 320,
    shares: 88,
    gifts: 44,
    credits: {
      performer: "Atlas Vex",
      writer: "Atlas Vex",
      composer: "Atlas Vex",
      producer: "Skyline",
    },
  },
];

export const trendingTags = [
  "#neonpop",
  "#midnightcover",
  "#battle24",
  "#djset",
  "#originalsong",
  "#studio",
  "#autotune",
  "#karaoke",
];

export const genres = [
  "Pop",
  "Hip-Hop",
  "R&B",
  "Electronic",
  "House",
  "Techno",
  "Rock",
  "Latin",
  "Afrobeats",
  "K-Pop",
  "Jazz",
  "Classical",
];

export const competitions = [
  {
    id: "c1",
    title: "Global Voice 2026",
    stage: "final",
    participants: 8,
    prize: "$50,000",
    cover: cover(320, "comp1"),
  },
  {
    id: "c2",
    title: "Cover Wars — Season 4",
    stage: "semi",
    participants: 32,
    prize: "$12,000",
    cover: cover(280, "comp2"),
  },
  {
    id: "c3",
    title: "Original Songwriting Cup",
    stage: "quarter",
    participants: 64,
    prize: "$8,000",
    cover: cover(200, "comp3"),
  },
  {
    id: "c4",
    title: "DJ Battle Underground",
    stage: "quarter",
    participants: 128,
    prize: "$5,000",
    cover: cover(250, "comp4"),
  },
];

export const liveRooms = [
  { id: "l1", host: "Nova Ray", type: "battle", viewers: 12400, avatar: avatars("nova") },
  { id: "l2", host: "DJ Nyx", type: "set", viewers: 8900, avatar: avatars("nyx") },
  { id: "l3", host: "Lila Moon", type: "acoustic", viewers: 3200, avatar: avatars("lila") },
  { id: "l4", host: "Atlas Vex", type: "battle", viewers: 2100, avatar: avatars("atlas") },
];

export const notifications = [
  { id: "n1", type: "like", user: "Nova Ray", avatar: avatars("nova"), time: "2m" },
  { id: "n2", type: "follow", user: "DJ Nyx", avatar: avatars("nyx"), time: "18m" },
  {
    id: "n3",
    type: "gift",
    user: "Lila Moon",
    avatar: avatars("lila"),
    time: "1h",
    extra: "💎 Diamond",
  },
  {
    id: "n4",
    type: "comment",
    user: "Atlas Vex",
    avatar: avatars("atlas"),
    time: "3h",
    extra: "🔥🔥🔥",
  },
  { id: "n5", type: "invited", user: "Global Voice 2026", avatar: avatars("gv"), time: "1d" },
];

export const gifts = [
  { id: "g1", key: "rose", emoji: "🌹", coins: 10 },
  { id: "g2", key: "mic", emoji: "🎤", coins: 50 },
  { id: "g3", key: "disc", emoji: "💿", coins: 200 },
  { id: "g4", key: "diamond", emoji: "💎", coins: 500 },
  { id: "g5", key: "crown", emoji: "👑", coins: 1200 },
  { id: "g6", key: "rocket", emoji: "🚀", coins: 3000 },
];

export function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}
