import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { liveRooms, users } from "@/db/schema";
import { requireUserId, getSessionUser } from "./auth";

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
    return { room, token, livekitUrl: process.env.LIVEKIT_URL };
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

    const token = await createToken(userId, me!.name, room.livekitRoomName, false);
    return { room, token, livekitUrl: process.env.LIVEKIT_URL };
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
