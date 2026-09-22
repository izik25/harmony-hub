import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import { liveRooms, liveRoomGuests, livePkBattles, users } from "@/db/schema";
import { requireUserId, getSessionUser } from "./auth";
import { insertNotification } from "./notifications";
import {
  isLiveKitConfigured,
  getLiveKitRoomService,
  createLiveKitToken,
  pushLiveData,
} from "@/lib/livekit-server";

// Max simultaneous on-stage guests (host doesn't count against this) — a real limit rather than
// an unbounded roster, matching what a phone screen can actually lay tiles out for.
const MAX_LIVE_GUESTS = 4;

// Default PK battle length — long enough for gifts to actually accumulate, short enough that
// "linking two lives" reads as an event rather than a permanent state.
const PK_DURATION_SECONDS = 180;

type UserBrief = { id: string; name: string; handle: string; avatarUrl: string };

async function getUserBrief(userId: string): Promise<UserBrief | null> {
  const [row] = await db
    .select({ id: users.id, name: users.name, handle: users.handle, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}

// The livekitRoomName of whatever room this user is currently live in themselves (as host or an
// already-seated guest), if any — used to deliver a real-time popup (invite, PK challenge, ...)
// into the room they're actually connected to right now, since pushing into a *different* room
// they haven't joined would just be a no-op. Returns null if they're not currently live anywhere,
// which is the common case and not an error — callers fall back to the DB notification alone.
async function findLiveRoomFor(userId: string): Promise<string | null> {
  const [asHost] = await db
    .select({ livekitRoomName: liveRooms.livekitRoomName })
    .from(liveRooms)
    .where(and(eq(liveRooms.hostId, userId), eq(liveRooms.status, "live")));
  if (asHost) return asHost.livekitRoomName;

  const [asGuest] = await db
    .select({ livekitRoomName: liveRooms.livekitRoomName })
    .from(liveRoomGuests)
    .innerJoin(liveRooms, eq(liveRooms.id, liveRoomGuests.roomId))
    .where(
      and(
        eq(liveRoomGuests.userId, userId),
        eq(liveRoomGuests.status, "live"),
        eq(liveRooms.status, "live"),
      ),
    );
  return asGuest?.livekitRoomName ?? null;
}

export const isLiveConfigured = createServerFn({ method: "GET" }).handler(async () => {
  return isLiveKitConfigured();
});

export const listLiveRooms = createServerFn({ method: "GET" }).handler(async () => {
  return db
    .select({
      id: liveRooms.id,
      title: liveRooms.title,
      type: liveRooms.type,
      createdAt: liveRooms.createdAt,
      host: { id: users.id, name: users.name, handle: users.handle, avatarUrl: users.avatarUrl },
    })
    .from(liveRooms)
    .innerJoin(users, eq(users.id, liveRooms.hostId))
    .where(eq(liveRooms.status, "live"))
    .orderBy(desc(liveRooms.createdAt));
});

export const startRoom = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { title: string; type: string })
  .handler(async ({ data }) => {
    if (!isLiveKitConfigured()) throw new Error("liveNotConfigured");
    const userId = await requireUserId();
    const me = await getSessionUser();
    const livekitRoomName = `sona-${randomUUID()}`;

    await getLiveKitRoomService().createRoom({
      name: livekitRoomName,
      emptyTimeout: 300,
      maxParticipants: 200,
    });
    const [room] = await db
      .insert(liveRooms)
      .values({
        hostId: userId,
        title: data.title || "Live session",
        type: data.type,
        livekitRoomName,
      })
      .returning();

    const token = await createLiveKitToken(userId, me!.name, livekitRoomName, true);
    return { room, token, livekitUrl: process.env.LIVEKIT_URL, role: "host" as const };
  });

// Challenge a specific user to a live duet battle: starts a "battle" room the challenger
// immediately hosts (same as startRoom), seats the invited user as the room's first guest (see
// liveRoomGuests), and notifies them so they can jump straight into the room as a co-publisher —
// see joinRoom's role resolution below.
export const challengeToDuet = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { opponentId: string; title?: string })
  .handler(async ({ data }) => {
    if (!isLiveKitConfigured()) throw new Error("liveNotConfigured");
    const userId = await requireUserId();
    if (userId === data.opponentId) throw new Error("cantChallengeSelf");
    const me = await getSessionUser();
    const opponent = await getUserBrief(data.opponentId);
    if (!opponent) throw new Error("userNotFound");

    const livekitRoomName = `sona-${randomUUID()}`;
    await getLiveKitRoomService().createRoom({
      name: livekitRoomName,
      emptyTimeout: 300,
      maxParticipants: 200,
    });
    const [room] = await db
      .insert(liveRooms)
      .values({
        hostId: userId,
        title: data.title || `${me!.name} vs ${opponent.name}`,
        type: "battle",
        livekitRoomName,
      })
      .returning();
    await db.insert(liveRoomGuests).values({ roomId: room.id, userId: data.opponentId });

    const token = await createLiveKitToken(userId, me!.name, livekitRoomName, true);
    await insertNotification({
      userId: data.opponentId,
      actorId: userId,
      type: "duet_challenge",
      extra: { roomId: room.id },
    });
    return { room, token, livekitUrl: process.env.LIVEKIT_URL, role: "host" as const, opponent };
  });

// Host invites someone else to join the broadcast on stage — either at room creation time
// (challengeToDuet above, seating its one opponent the same way) or any time mid-stream, up to
// MAX_LIVE_GUESTS at once. Always sends a durable DB notification; if the invitee happens to be
// live themselves right now (hosting or guesting somewhere else), also pushes a real-time popup
// into *their* current room over LiveKit's data channel — sending it into the inviting room would
// be a no-op, since the invitee isn't connected there yet.
export const inviteGuest = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { roomId: string; userId: string })
  .handler(async ({ data }) => {
    if (!isLiveKitConfigured()) throw new Error("liveNotConfigured");
    const hostUserId = await requireUserId();
    const me = await getSessionUser();
    if (hostUserId === data.userId) throw new Error("cantInviteSelf");
    const [room] = await db
      .select()
      .from(liveRooms)
      .where(and(eq(liveRooms.id, data.roomId), eq(liveRooms.status, "live")));
    if (!room) throw new Error("roomEnded");
    if (room.hostId !== hostUserId) throw new Error("hostOnly");

    const invitee = await getUserBrief(data.userId);
    if (!invitee) throw new Error("userNotFound");

    const activeGuests = await db
      .select()
      .from(liveRoomGuests)
      .where(
        and(
          eq(liveRoomGuests.roomId, room.id),
          inArray(liveRoomGuests.status, ["invited", "live"]),
        ),
      );
    if (activeGuests.some((g) => g.userId === data.userId)) throw new Error("alreadyInvited");
    if (activeGuests.length >= MAX_LIVE_GUESTS) throw new Error("guestSlotsFull");

    await db.insert(liveRoomGuests).values({ roomId: room.id, userId: data.userId });
    await insertNotification({
      userId: data.userId,
      actorId: hostUserId,
      type: "live_guest_invite",
      extra: { roomId: room.id },
    });
    const inviteeCurrentRoom = await findLiveRoomFor(data.userId);
    if (inviteeCurrentRoom) {
      await pushLiveData(
        inviteeCurrentRoom,
        { kind: "guest_invite", roomId: room.id, from: me!.name },
        [data.userId],
      );
    }
    return { ok: true, invitee };
  });

// Host removes a guest from the stage — flips their roster row and actually disconnects them from
// LiveKit immediately (marking the DB row alone would leave them visibly on camera until they
// happened to reconnect/refresh).
export const removeGuest = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { roomId: string; userId: string })
  .handler(async ({ data }) => {
    const hostUserId = await requireUserId();
    const [room] = await db.select().from(liveRooms).where(eq(liveRooms.id, data.roomId));
    if (!room) throw new Error("roomNotFound");
    if (room.hostId !== hostUserId) throw new Error("hostOnly");

    await db
      .update(liveRoomGuests)
      .set({ status: "removed", removedAt: new Date() })
      .where(and(eq(liveRoomGuests.roomId, room.id), eq(liveRoomGuests.userId, data.userId)));
    if (isLiveKitConfigured()) {
      await getLiveKitRoomService()
        .removeParticipant(room.livekitRoomName, data.userId)
        .catch(() => {});
    }
    return { ok: true };
  });

// The room's current on-stage roster (host is returned separately by joinRoom/session state —
// this is guests only), for the room page's tile strip and the host's "who's already up here"
// check before opening the invite picker.
export const listLiveRoomGuests = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { roomId: string })
  .handler(async ({ data }) => {
    const rows = await db
      .select({
        id: liveRoomGuests.id,
        userId: liveRoomGuests.userId,
        status: liveRoomGuests.status,
        user: { id: users.id, name: users.name, handle: users.handle, avatarUrl: users.avatarUrl },
      })
      .from(liveRoomGuests)
      .innerJoin(users, eq(users.id, liveRoomGuests.userId))
      .where(
        and(
          eq(liveRoomGuests.roomId, data.roomId),
          inArray(liveRoomGuests.status, ["invited", "live"]),
        ),
      );
    return rows;
  });

export const joinRoom = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { roomId: string })
  .handler(async ({ data }) => {
    if (!isLiveKitConfigured()) throw new Error("liveNotConfigured");
    const userId = await requireUserId();
    const me = await getSessionUser();
    const [room] = await db
      .select()
      .from(liveRooms)
      .where(and(eq(liveRooms.id, data.roomId), eq(liveRooms.status, "live")));
    if (!room) throw new Error("roomEnded");

    let role: "host" | "guest" | "viewer" = "viewer";
    if (room.hostId === userId) {
      role = "host";
    } else {
      const [guestRow] = await db
        .select()
        .from(liveRoomGuests)
        .where(and(eq(liveRoomGuests.roomId, room.id), eq(liveRoomGuests.userId, userId)));
      if (guestRow && guestRow.status !== "removed") {
        role = "guest";
        if (guestRow.status === "invited") {
          await db
            .update(liveRoomGuests)
            .set({ status: "live", joinedAt: new Date() })
            .where(eq(liveRoomGuests.id, guestRow.id));
        }
      }
    }

    const token = await createLiveKitToken(
      userId,
      me!.name,
      room.livekitRoomName,
      role !== "viewer",
    );
    const host = await getUserBrief(room.hostId);
    const guests = await db
      .select({
        userId: liveRoomGuests.userId,
        user: { id: users.id, name: users.name, handle: users.handle, avatarUrl: users.avatarUrl },
      })
      .from(liveRoomGuests)
      .innerJoin(users, eq(users.id, liveRoomGuests.userId))
      .where(and(eq(liveRoomGuests.roomId, room.id), eq(liveRoomGuests.status, "live")));
    return {
      room,
      token,
      livekitUrl: process.env.LIVEKIT_URL,
      role,
      host,
      guests: guests.map((g) => g.user),
    };
  });

export const endRoom = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { roomId: string })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const [room] = await db
      .select()
      .from(liveRooms)
      .where(and(eq(liveRooms.id, data.roomId), eq(liveRooms.hostId, userId)));
    if (!room) throw new Error("roomNotFound");

    await db
      .update(liveRooms)
      .set({ status: "ended", endedAt: new Date() })
      .where(eq(liveRooms.id, room.id));
    await resolveActiveBattleFor(room.id);
    if (isLiveKitConfigured()) {
      await getLiveKitRoomService()
        .deleteRoom(room.livekitRoomName)
        .catch(() => {});
    }
    return { ok: true };
  });

// --- PK battles: linking two independently-hosted, already-live rooms into a TikTok-style split-
// screen competition scored by gifts sent during the battle window. See livePkBattles in schema.ts
// for the full shape/reasoning.

async function activeBattleFor(roomId: string) {
  const [battle] = await db
    .select()
    .from(livePkBattles)
    .where(
      and(
        or(eq(livePkBattles.roomAId, roomId), eq(livePkBattles.roomBId, roomId)),
        inArray(livePkBattles.status, ["pending", "active"]),
      ),
    )
    .orderBy(desc(livePkBattles.createdAt));
  return battle ?? null;
}

// Called when a room hosting a live battle ends outright (not a normal battle timeout) — resolves
// it the same way endPkBattle would (winner = higher score) rather than leaving it dangling in
// "active"/"pending" forever with a room that no longer exists. A still-"pending" invite (never
// accepted) just gets declined; an "active" one gets scored and ended.
async function resolveActiveBattleFor(roomId: string) {
  const battle = await activeBattleFor(roomId);
  if (!battle) return;
  const status = battle.status === "pending" ? "declined" : "ended";
  const winnerRoomId =
    status === "ended"
      ? battle.scoreA === battle.scoreB
        ? null
        : battle.scoreA > battle.scoreB
          ? battle.roomAId
          : battle.roomBId
      : null;
  await db
    .update(livePkBattles)
    .set({ status, endedAt: new Date(), winnerRoomId })
    .where(eq(livePkBattles.id, battle.id));
  const [roomA] = await db.select().from(liveRooms).where(eq(liveRooms.id, battle.roomAId));
  const [roomB] = await db.select().from(liveRooms).where(eq(liveRooms.id, battle.roomBId));
  const payload = {
    kind: status === "declined" ? "pk_declined" : "pk_ended",
    battleId: battle.id,
    scoreA: battle.scoreA,
    scoreB: battle.scoreB,
    winnerRoomId,
  };
  if (roomA) await pushLiveData(roomA.livekitRoomName, payload);
  if (roomB) await pushLiveData(roomB.livekitRoomName, payload);
}

// Host of `roomId` challenges another currently-live room to a PK battle. Guards: both rooms live,
// neither already mid-battle, can't challenge your own room.
export const invitePkBattle = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { roomId: string; targetRoomId: string })
  .handler(async ({ data }) => {
    const hostUserId = await requireUserId();
    const me = await getSessionUser();
    if (data.roomId === data.targetRoomId) throw new Error("cantBattleSelf");
    const [roomA] = await db
      .select()
      .from(liveRooms)
      .where(and(eq(liveRooms.id, data.roomId), eq(liveRooms.status, "live")));
    if (!roomA) throw new Error("roomEnded");
    if (roomA.hostId !== hostUserId) throw new Error("hostOnly");
    const [roomB] = await db
      .select()
      .from(liveRooms)
      .where(and(eq(liveRooms.id, data.targetRoomId), eq(liveRooms.status, "live")));
    if (!roomB) throw new Error("roomEnded");

    if ((await activeBattleFor(roomA.id)) || (await activeBattleFor(roomB.id))) {
      throw new Error("alreadyInBattle");
    }

    const [battle] = await db
      .insert(livePkBattles)
      .values({
        roomAId: roomA.id,
        roomBId: roomB.id,
        durationSeconds: PK_DURATION_SECONDS,
      })
      .returning();

    await insertNotification({
      userId: roomB.hostId,
      actorId: hostUserId,
      type: "pk_challenge",
      extra: { battleId: battle.id, roomId: roomB.id },
    });
    await pushLiveData(
      roomB.livekitRoomName,
      { kind: "pk_challenge", battleId: battle.id, roomId: roomA.id, from: me!.name },
      [roomB.hostId],
    );
    return { battle };
  });

// Target host accepts or declines. Accepting starts the clock and tells both rooms' viewers to
// switch into split-screen at the same moment.
export const respondToPkBattle = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { battleId: string; accept: boolean })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const [battle] = await db
      .select()
      .from(livePkBattles)
      .where(eq(livePkBattles.id, data.battleId));
    if (!battle || battle.status !== "pending") throw new Error("battleNotFound");
    const [roomB] = await db.select().from(liveRooms).where(eq(liveRooms.id, battle.roomBId));
    if (!roomB || roomB.hostId !== userId) throw new Error("hostOnly");
    const [roomA] = await db.select().from(liveRooms).where(eq(liveRooms.id, battle.roomAId));
    if (!roomA) throw new Error("roomEnded");

    if (!data.accept) {
      await db
        .update(livePkBattles)
        .set({ status: "declined", endedAt: new Date() })
        .where(eq(livePkBattles.id, battle.id));
      await pushLiveData(roomA.livekitRoomName, { kind: "pk_declined", battleId: battle.id });
      return { ok: true, accepted: false };
    }

    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + battle.durationSeconds * 1000);
    const [updated] = await db
      .update(livePkBattles)
      .set({ status: "active", startedAt, endsAt })
      .where(eq(livePkBattles.id, battle.id))
      .returning();
    const payload = {
      kind: "pk_started",
      battleId: battle.id,
      roomAId: roomA.id,
      roomBId: roomB.id,
      endsAt: endsAt.toISOString(),
    };
    await pushLiveData(roomA.livekitRoomName, payload);
    await pushLiveData(roomB.livekitRoomName, payload);
    return { ok: true, accepted: true, battle: updated };
  });

// Either host can end the battle early; a battle whose clock has simply run out is resolved
// lazily the next time getPkBattle/sendGift notices `now > endsAt` while still "active" (see
// getPkBattle below) — no cron/queue needed for a 3-minute window.
export const endPkBattle = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { battleId: string })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const [battle] = await db
      .select()
      .from(livePkBattles)
      .where(eq(livePkBattles.id, data.battleId));
    if (!battle || battle.status !== "active") throw new Error("battleNotFound");
    const [roomA] = await db.select().from(liveRooms).where(eq(liveRooms.id, battle.roomAId));
    const [roomB] = await db.select().from(liveRooms).where(eq(liveRooms.id, battle.roomBId));
    if (roomA?.hostId !== userId && roomB?.hostId !== userId) throw new Error("hostOnly");

    const winnerRoomId =
      battle.scoreA === battle.scoreB
        ? null
        : battle.scoreA > battle.scoreB
          ? battle.roomAId
          : battle.roomBId;
    await db
      .update(livePkBattles)
      .set({ status: "ended", endedAt: new Date(), winnerRoomId })
      .where(eq(livePkBattles.id, battle.id));
    const payload = {
      kind: "pk_ended",
      battleId: battle.id,
      scoreA: battle.scoreA,
      scoreB: battle.scoreB,
      winnerRoomId,
    };
    if (roomA) await pushLiveData(roomA.livekitRoomName, payload);
    if (roomB) await pushLiveData(roomB.livekitRoomName, payload);
    return { ok: true };
  });

// The caller's room's current pending/active/just-ended battle (if any), plus a subscribe-only
// token for the *other* room — the room page uses this to open a second, read-only LiveKit
// connection and render the paired host's video alongside its own for the split-screen.
export const getPkBattle = createServerFn({ method: "GET" })
  .validator((input: unknown) => input as { roomId: string })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const me = await getSessionUser();
    const [battle] = await db
      .select()
      .from(livePkBattles)
      .where(or(eq(livePkBattles.roomAId, data.roomId), eq(livePkBattles.roomBId, data.roomId)))
      .orderBy(desc(livePkBattles.createdAt));
    if (!battle) return null;

    // Lazily resolve a battle whose clock ran out without anyone tapping "end".
    if (battle.status === "active" && battle.endsAt && battle.endsAt.getTime() <= Date.now()) {
      const winnerRoomId =
        battle.scoreA === battle.scoreB
          ? null
          : battle.scoreA > battle.scoreB
            ? battle.roomAId
            : battle.roomBId;
      await db
        .update(livePkBattles)
        .set({ status: "ended", endedAt: new Date(), winnerRoomId })
        .where(eq(livePkBattles.id, battle.id));
      battle.status = "ended";
      battle.winnerRoomId = winnerRoomId;
    }

    const otherRoomId = battle.roomAId === data.roomId ? battle.roomBId : battle.roomAId;
    const [otherRoom] = await db.select().from(liveRooms).where(eq(liveRooms.id, otherRoomId));
    const otherHost = otherRoom ? await getUserBrief(otherRoom.hostId) : null;
    const viewToken =
      otherRoom && isLiveKitConfigured()
        ? await createLiveKitToken(userId, me!.name, otherRoom.livekitRoomName, false)
        : null;

    return {
      battle,
      mySide: battle.roomAId === data.roomId ? ("A" as const) : ("B" as const),
      otherRoom: otherRoom
        ? { id: otherRoom.id, livekitRoomName: otherRoom.livekitRoomName, host: otherHost }
        : null,
      livekitUrl: process.env.LIVEKIT_URL,
      viewToken,
    };
  });
