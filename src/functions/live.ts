import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { liveRooms, users } from "@/db/schema";
import { requireUserId, getSessionUser } from "./auth";
import { insertNotification } from "./notifications";

type UserBrief = { id: string; name: string; handle: string; avatarUrl: string };

async function getUserBrief(userId: string): Promise<UserBrief | null> {
  const [row] = await db
    .select({ id: users.id, name: users.name, handle: users.handle, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}

function isConfigured(): boolean {
  return !!(
    process.env.LIVEKIT_URL &&
    process.env.LIVEKIT_API_KEY &&
    process.env.LIVEKIT_API_SECRET
  );
}

function getRoomService() {
  return new RoomServiceClient(
    process.env.LIVEKIT_URL!,
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  );
}

async function createToken(identity: string, name: string, roomName: string, canPublish: boolean) {
  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
    identity,
    name,
  });
  at.addGrant({ roomJoin: true, room: roomName, canPublish, canSubscribe: true });
  return at.toJwt();
}

export const isLiveConfigured = createServerFn({ method: "GET" }).handler(async () => {
  return isConfigured();
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
    if (!isConfigured()) throw new Error("liveNotConfigured");
    const userId = await requireUserId();
    const me = await getSessionUser();
    const livekitRoomName = `sona-${randomUUID()}`;

    await getRoomService().createRoom({
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

    const token = await createToken(userId, me!.name, livekitRoomName, true);
    return { room, token, livekitUrl: process.env.LIVEKIT_URL, role: "host" as const };
  });

// Challenge a specific user to a live duet battle: starts a "battle" room the challenger
// immediately hosts (same as startRoom), plus a notification with the roomId so the invited user
// can jump straight into the room as a co-publisher — see joinRoom's role resolution below.
export const challengeToDuet = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { opponentId: string; title?: string })
  .handler(async ({ data }) => {
    if (!isConfigured()) throw new Error("liveNotConfigured");
    const userId = await requireUserId();
    if (userId === data.opponentId) throw new Error("cantChallengeSelf");
    const me = await getSessionUser();
    const opponent = await getUserBrief(data.opponentId);
    if (!opponent) throw new Error("userNotFound");

    const livekitRoomName = `sona-${randomUUID()}`;
    await getRoomService().createRoom({
      name: livekitRoomName,
      emptyTimeout: 300,
      maxParticipants: 200,
    });
    const [room] = await db
      .insert(liveRooms)
      .values({
        hostId: userId,
        opponentId: data.opponentId,
        title: data.title || `${me!.name} vs ${opponent.name}`,
        type: "battle",
        livekitRoomName,
      })
      .returning();

    const token = await createToken(userId, me!.name, livekitRoomName, true);
    await insertNotification({
      userId: data.opponentId,
      actorId: userId,
      type: "duet_challenge",
      extra: { roomId: room.id },
    });
    return { room, token, livekitUrl: process.env.LIVEKIT_URL, role: "host" as const, opponent };
  });

export const joinRoom = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { roomId: string })
  .handler(async ({ data }) => {
    if (!isConfigured()) throw new Error("liveNotConfigured");
    const userId = await requireUserId();
    const me = await getSessionUser();
    const [room] = await db
      .select()
      .from(liveRooms)
      .where(and(eq(liveRooms.id, data.roomId), eq(liveRooms.status, "live")));
    if (!room) throw new Error("roomEnded");

    const role =
      room.hostId === userId ? "host" : room.opponentId === userId ? "opponent" : "viewer";
    const token = await createToken(userId, me!.name, room.livekitRoomName, role !== "viewer");
    const host = await getUserBrief(room.hostId);
    const opponent = room.opponentId ? await getUserBrief(room.opponentId) : null;
    return { room, token, livekitUrl: process.env.LIVEKIT_URL, role, host, opponent };
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
    if (isConfigured()) {
      await getRoomService()
        .deleteRoom(room.livekitRoomName)
        .catch(() => {});
    }
    return { ok: true };
  });
